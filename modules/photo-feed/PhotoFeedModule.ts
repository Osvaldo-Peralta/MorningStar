// modules/photo-feed/PhotoFeedModule.ts
import { AppModule } from '../../core/module'
import { CoreContext } from '../../core/context/CoreContext'
import { ModuleState } from '../../core/module/ModuleState.js'
import { PhotoFeedService } from './domain/PhotoFeedService.js'
import { EditPhotoInput } from './domain/EditPhotoInput'
import { PhotoAddedPayload, PhotoEditedPayload } from './events.js'
import { DomainEvent } from '../../core/context/DomainEvent'
import { Photo } from './domain/Photo'

export class PhotoFeedModule implements AppModule {
  readonly id = 'photo-feed'
  readonly version = '0.2.0'
  private readonly STORAGE_KEY = 'photo-feed:data'            // Namespace del modulo
  
  private service?: PhotoFeedService
  private storage?: CoreContext['storage']
  private events?: CoreContext['events']

  // Se mantiene el estado inicial requerido por la interfaz AppModule
  state = ModuleState.Registered 

  async init(context: CoreContext): Promise<void> {
    this.service = new PhotoFeedService()
    this.storage = context.storage
    this.events = context.events

    // 1. Hidratación: Recuperamos URLs guardadas
    const savedUrls = await this.storage.get<string[]>(this.STORAGE_KEY)
    if(savedUrls && Array.isArray(savedUrls)) {
      // Reinstanciamos las fotos en el servicio de dominio
      savedUrls.forEach(url => this.service?.addPhoto(url))
    }
  }

  private async persist(): Promise<void> {
      if (this.service && this.storage) {
        // Guardamos solo lo necesario (las URLs) para reconstruir el estado
        const urls = this.service.listPhotos()
        await this.storage.set(this.STORAGE_KEY, urls)
      }
    }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async dispose(): Promise<void> {
    this.service = undefined
    this.events = undefined
    this.storage = undefined      // Limpieza completa de referencias
  }

  /** API pública del módulo */
  async addPhoto(url: string): Promise<void> {
    if (!this.service || !this.events) throw new Error('Not Initialized')

    if(!url || !url.startsWith('http')) throw new Error('Invalid photo URL')

    const photo = this.service.addPhoto(url)
    await this.persist()

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
    if(!this.service || !this.events) throw new Error('Not Initialized')

    const  { updatedPhoto, changes } = this.service.editPhoto(photoId, input)

    // Si no hay cambios reales, no disparamos eventos (clean logic)
    if(Object.keys(changes).length === 0) return

    // Persistencia en el nuevo estado (Lista de Urls actualizada)
    await this.persist()

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
    if(!this.service || !this.events) throw new Error('Not Initialized')
    
    // 1. Ejecutamos la eliminación en dominio
    this.service.removePhoto(photoId)
    // 2. Sincronizamos con el storage
    await this.persist();
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

  // Cambio de listoPhotos por listEntries para que el UI reciba objetos Photo

  listEntries(): Photo[] {
    if(!this.service) throw new Error('PhotoFeedModule not Initialized')
      return this.service.listEntries()
  }
  /*
  listPhotos(): string[] {
    if (!this.service) {
      throw new Error('PhotoFeedModule not initialized')
    }
    return this.service.listPhotos()
  }
  */
}
