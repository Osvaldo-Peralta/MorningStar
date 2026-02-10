import { AppModule } from '../../core/module'
import { CoreContext } from '../../core/context/CoreContext'
import { ModuleState } from '../../core/module/ModuleState'
import { PhotoFeedService } from './domain/PhotoFeedService'

export class PhotoFeedModule implements AppModule {
  readonly id = 'photo-feed'
  readonly version = '0.1.0'
  state = ModuleState.Registered

  private service?: PhotoFeedService
  private events?: CoreContext['events']

  async init(context: CoreContext): Promise<void> {
    this.service = new PhotoFeedService()
    this.events = context.events
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async dispose(): Promise<void> {
    this.service = undefined
    this.events = undefined
  }

  /** API pública del módulo */
  addPhoto(url: string): void {
    if (!this.service || !this.events) {
      throw new Error('PhotoFeedModule not initialized')
    }

    const photo = this.service.addPhoto(url)

    // 📣 Emitimos evento de dominio
    ;(this.events as any).emit({
      name: 'photo:added',
      category: 'domain',
      source: {
        moduleId: this.id,
        entity: 'photo',
      },
      payload: {
        photoId: photo.id,
        url: photo.url,
        addedAt: photo.createdAt,
      },
      timestamp: Date.now(),
    })
  }

  listPhotos(): string[] {
    if (!this.service) {
      throw new Error('PhotoFeedModule not initialized')
    }
    return this.service.listPhotos()
  }
}
