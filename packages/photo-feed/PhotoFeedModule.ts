// modules/photo-feed/PhotoFeedModule.ts
import { ModuleState, toMediaRef } from '@morningstar/core'
import type {
  ActorContext,
  AppModule,
  Authorizer,
  CoreContext,
  DomainEvent,
  MediaStorage,
  Repository,
} from '@morningstar/core'
import { nanoid } from 'nanoid'
import { PhotoFeedService } from './domain/PhotoFeedService.js'
import type { EditPhotoInput } from './domain/EditPhotoInput.js'
import type { PhotoAddedPayload, PhotoEditedPayload } from './events.js'
import { Photo } from './domain/Photo.js'
import type { PhotoRecord } from './domain/PhotoRecord.js'
import { validatePhotoMedia, type PhotoMediaInput } from './domain/mediaPolicy.js'
import { PermissionDeniedError, PermissionRequiredError } from './errors.js'

/** Namespace del repositorio (ADR-0002/0003: `<modulo>:<recurso>`). */
const REPO_NAMESPACE = 'photo-feed:photos'

/** Clave legacy del esquema anterior (Storage KV con `string[]` de URLs). */
const LEGACY_STORAGE_KEY = 'photo-feed:data'

export class PhotoFeedModule implements AppModule {
  readonly id = 'photo-feed'
  readonly version = '0.4.0'

  private service?: PhotoFeedService
  private repository?: Repository<PhotoRecord>
  private storage?: CoreContext['storage']
  private media?: MediaStorage
  private authorizer?: Authorizer
  private events?: CoreContext['events']

  // Se mantiene el estado inicial requerido por la interfaz AppModule
  state = ModuleState.Registered

  async init(context: CoreContext): Promise<void> {
    // Camino único (Fase 1): la persistencia con identidad estable es
    // obligatoria para este módulo.
    if (!context.persistence) {
      throw new Error(
        "PhotoFeedModule requiere 'context.persistence' (PersistenceProvider). Ver docs/contracts/photo-feed.md"
      )
    }

    this.service = new PhotoFeedService()
    this.repository = context.persistence.repository<PhotoRecord>(REPO_NAMESPACE)
    this.storage = context.storage
    this.media = context.media   // opcional: solo lo requiere addPhotoFromFile
    this.authorizer = context.authorizer // opcional: activa el enforcement (ADR-0012)
    this.events = context.events

    // 1. Migración única del esquema legacy (URLs en Storage) al repositorio
    await this.migrateLegacyUrls()

    // 2. Hidratación: records → agregados, preservando identidad estable.
    //    Las URIs de medios son efímeras: se re-resuelven en cada sesión.
    const records = await this.repository.list()
    for (const record of records) {
      let resolvedMediaUri = ''
      if (record.media && this.media) {
        // Media huérfana (bytes perdidos) ⇒ URI vacía: la foto se conserva
        // y la UI mostrará un placeholder (ADR-0004).
        resolvedMediaUri = (await this.media.getUri(record.media.mediaId)) ?? ''
      }
      this.service.restore(Photo.fromRecord(record, resolvedMediaUri))
    }
  }

  /**
   * Migra por única vez los datos del esquema anterior (`photo-feed:data`,
   * un `string[]` de URLs en el puerto Storage) al repositorio. Es la última
   * vez que los ids se regeneran para fotos legacy; luego se descarta la
   * clave vieja.
   */
  private async migrateLegacyUrls(): Promise<void> {
    if (!this.storage || !this.repository) return

    const legacyUrls = await this.storage.get<string[]>(LEGACY_STORAGE_KEY)

    if (Array.isArray(legacyUrls) && legacyUrls.length > 0) {
      const existing = await this.repository.list()
      if (existing.length === 0) {
        for (const url of legacyUrls) {
          const photo = new Photo(nanoid(), url)
          await this.repository.save(photo.toRecord())
        }
      }
    }

    if (legacyUrls !== null) {
      await this.storage.remove(LEGACY_STORAGE_KEY)
    }
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async dispose(): Promise<void> {
    this.service = undefined
    this.events = undefined
    this.storage = undefined
    this.media = undefined
    this.authorizer = undefined
    this.repository = undefined   // Limpieza completa de referencias
  }

  /**
   * Enforcement de autorización (ADR-0012), fail-closed:
   * - Sin `authorizer` en el contexto ⇒ comportamiento local actual.
   * - Con `authorizer` y sin actor ⇒ `PermissionRequiredError` (no existen
   *   operaciones anónimas con autorización activa).
   * - DENY o CONDITIONAL ⇒ `PermissionDeniedError` ANTES de tocar el dominio
   *   (cero efectos colaterales). CONDITIONAL se trata como denegación: el
   *   loop de cumplimiento de condiciones pertenece al composition layer.
   */
  private async checkPermission(
    permission: string,
    resource: { type: string; id?: string; ownerId?: string } | undefined,
    actor?: ActorContext
  ): Promise<void> {
    if (!this.authorizer) return
    if (!actor) throw new PermissionRequiredError(permission)

    const decision = await this.authorizer.authorize(
      resource ? { permission, resource } : { permission },
      actor.sessionToken
    )

    if (decision.decision === 'ALLOW') return

    throw new PermissionDeniedError(
      permission,
      decision.decision as 'DENY' | 'CONDITIONAL',
      decision.reason,
      decision.conditions
    )
  }

  /** API pública del módulo */
  async addPhoto(url: string, actor?: ActorContext): Promise<void> {
    if (!this.service || !this.events || !this.repository) throw new Error('Not Initialized')

    if(!url || !url.startsWith('http')) throw new Error('Invalid photo URL')

    // Enforcement antes de cualquier efecto (ADR-0012)
    await this.checkPermission('photo:create', undefined, actor)

    const photo = this.service.addPhoto(url, actor?.userId)
    await this.repository.save(photo.toRecord())

    this.events.emit({
      name: 'photo:added',
      category: 'domain',
      source: {moduleId: this.id, entity: 'photo'},
      payload: {
        photoId: photo.id,
        url: photo.url,
        addedAt: photo.updatedAt,
        ownerId: photo.ownerId
      },
      timestamp: Date.now()
    })
  }

  /**
   * Subida real de archivo (Fase 2 / ADR-0004):
   * validar (dominio) → almacenar binario (puerto MediaStorage) →
   * agregado + metadata (Persistence) → evento.
   *
   * Requiere `context.media`; lanza errores descriptivos de validación
   * (tipo MIME o tamaño fuera de política) sin efectos colaterales.
   */
  async addPhotoFromFile(input: PhotoMediaInput, actor?: ActorContext): Promise<void> {
    if (!this.service || !this.events || !this.repository) throw new Error('Not Initialized')
    if (!this.media) {
      throw new Error(
        "PhotoFeedModule requiere 'context.media' (MediaStorage) para subir archivos. Ver docs/contracts/photo-feed.md"
      )
    }

    // Validación de negocio en el dominio: si falla, no se toca infraestructura
    validatePhotoMedia(input)

    // Enforcement antes de almacenar binarios (ADR-0012)
    await this.checkPermission('photo:create', undefined, actor)

    const object = await this.media.put(input.data, input.mimeType)
    const media = toMediaRef(object)
    const uri = (await this.media.getUri(object.id)) ?? ''

    const photo = this.service.addPhotoFromMedia(uri, media, actor?.userId)
    await this.repository.save(photo.toRecord())

    this.events.emit({
      name: 'photo:added',
      category: 'domain',
      source: {moduleId: this.id, entity: 'photo'},
      payload: {
        photoId: photo.id,
        url: uri,        // URI de sesión (efímera); los consumidores durables usan payload.media
        addedAt: photo.updatedAt,
        media,           // campo aditivo v1 (ADR-0001)
        ownerId: photo.ownerId
      },
      timestamp: Date.now()
    })
  }

  async editPhoto(photoId: string, input: EditPhotoInput, actor?: ActorContext): Promise<void> {
    if(!this.service || !this.events || !this.repository) throw new Error('Not Initialized')

    // Enforcement con el recurso (ownerId cuando se conoce) ANTES del dominio
    const existing = this.service.getPhotoById(photoId)
    await this.checkPermission(
      'photo:edit',
      { type: 'photo', id: photoId, ownerId: existing?.ownerId },
      actor
    )

    const  { updatedPhoto, changes } = this.service.editPhoto(photoId, input)

    // Si no hay cambios reales, no disparamos eventos (clean logic)
    if(Object.keys(changes).length === 0) return

    // Persistencia del agregado actualizado (identidad estable)
    await this.repository.save(updatedPhoto.toRecord())

    // Emitir evento de dominio
    const event: DomainEvent<PhotoEditedPayload> = {
      name: 'photo:edited',
      category: 'domain',
      source: {
        moduleId: this.id,
        entity: 'photo',
        entityId: photoId
      },
      // Se pasa el nuevo objeto literal para evitar mutaciones externas
      payload: {
        photoId: updatedPhoto.id,
        changes: {...changes} // Shallow copy de los cambios
      },
      timestamp: Date.now()
    }
    
    this.events.emit(event)
  }

  async removePhoto(photoId: string, actor?: ActorContext): Promise<void> {
    if(!this.service || !this.events || !this.repository) throw new Error('Not Initialized')

    // 0. Enforcement con el recurso ANTES del dominio (ADR-0012)
    const existing = this.service.getPhotoById(photoId)
    await this.checkPermission(
      'photo:delete',
      { type: 'photo', id: photoId, ownerId: existing?.ownerId },
      actor
    )

    // 1. Rescatamos la referencia al binario antes de eliminar el agregado
    const target = existing
    // 2. Ejecutamos la eliminación en dominio
    this.service.removePhoto(photoId)
    // 3. Sincronizamos con el repositorio
    await this.repository.remove(photoId)
    // 4. Best-effort: limpiamos el binario asociado. Si falla, la metadata
    //    ya está eliminada; el medio queda huérfano (ADR-0004 contempla un
    //    GC futuro). El borrado lógico nunca falla por esto.
    if (target?.media && this.media) {
      try {
        await this.media.remove(target.media.mediaId)
      } catch {
        // intentionally ignored (best-effort cleanup)
      }
    }
    // 5. Notificamos al sistema
    this.events.emit({
      name: 'photo:removed',
      category: 'domain',
      source: {
        moduleId: this.id,
        entity: 'photo',
        entityId: photoId
      },
      payload: {
        photoId,
        removedAt: Date.now()
      },
      timestamp: Date.now()
    })
  }

  listEntries(): Photo[] {
    if(!this.service) throw new Error('PhotoFeedModule not Initialized')
      return this.service.listEntries()
  }
}
