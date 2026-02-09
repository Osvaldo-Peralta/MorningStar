// modules/photo-feed/PhotoFeedModule.ts
import { AppModule } from '../../core/module'
import { CoreContext } from '../../core/context/CoreContext'
import { ModuleState } from '../../core/module/ModuleState'
import { PhotoFeedService } from './PhotoFeedService'

export class PhotoFeedModule implements AppModule {
  readonly id = 'photo-feed'
  readonly version = '0.1.0'
  state = ModuleState.Registered

  private service?: PhotoFeedService

  async init(context: CoreContext): Promise<void> {
    this.service = new PhotoFeedService(context.events)
  }

  async activate(): Promise<void> {
    // listo para operar
  }

  async deactivate(): Promise<void> {
    // no-op por ahora
  }

  async dispose(): Promise<void> {
    this.service?.clear()
    this.service = undefined
  }

  /** API pública del módulo */
  getService(): PhotoFeedService {
    if (!this.service) {
      throw new Error('PhotoFeedModule not initialized')
    }
    return this.service
  }
}
