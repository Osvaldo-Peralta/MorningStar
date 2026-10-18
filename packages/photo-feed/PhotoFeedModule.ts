// modules/photo-feed/PhotoFeedModule.ts
import { ModuleState } from '@morningstar/core'
import type { AppModule, CoreContext, DomainEvent, Repository } from '@morningstar/core'
import { nanoid } from 'nanoid'
import { PhotoFeedService } from './domain/PhotoFeedService.js'
import type { EditPhotoInput } from './domain/EditPhotoInput.js'
import type { PhotoAddedPayload, PhotoEditedPayload } from './events.js'
import { Photo } from './domain/Photo.js'
import type { PhotoRecord } from './domain/PhotoRecord.js'

/** Namespace del repositorio (ADR-0002/0003: `<modulo>:<recurso>`). */
const REPO_NAMESPACE = 'photo-feed:photos'

/** Clave legacy del esquema anterior (Storage KV con `string[]` de URLs). */
const LEGACY_STORAGE_KEY = 'photo-feed:data'

export class PhotoFeedModule implements AppModule {
  readonly id = 'photo-feed'
  readonly version = '0.3.0'

  private service?: PhotoFeedService
  private repository?: Repository<PhotoRecord>
  private storage?: CoreContext['storage']
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
    this.events = context.events

    // 1. Migración única del esquema legacy (URLs en Storage) al repositorio
    await this.migrateLegacyUrls()

    // 2. Hidratación: records → agregados, preservando identidad estable
    const records = await this.repository.list()
    for (const record of records) {
      this.service.restore(Photo.fromRecord(record))
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
    this.repository = undefined   // Limpieza completa de referencias
  }

  /** API pública del módulo */
  async addPhoto(url: string): Promise<void> {
    if (!this.service || !this.events || !this.repository) throw new Error('Not Initialized')

    if(!url || !url.startsWith('http')) throw new Error('Invalid photo URL')

    const photo = this.service.addPhoto(url)
    await this.repository.save(photo.toRecord())

    this.events.emit({
      name: 'photo:added',
      category: 'domain',
      source: {moduleId: this.id, entity: 'photo'},
      payload: {
        photoId: photo.id,
        url: photo.url,
        addedAt: photo.updatedAt
      },
      timestamp: Date.now()
    })
  }

  async editPhoto(photoId: string, input: EditPhotoInput): Promise<void> {
    if(!this.service || !this.events || !this.repository) throw new Error('Not Initialized')

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

  async removePhoto(photoId: string): Promise<void> {
    if(!this.service || !this.events || !this.repository) throw new Error('Not Initialized')
    
    // 1. Ejecutamos la eliminación en dominio
    this.service.removePhoto(photoId)
    // 2. Sincronizamos con el repositorio
    await this.repository.remove(photoId)
    // 3. Notificamos al sistema
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
