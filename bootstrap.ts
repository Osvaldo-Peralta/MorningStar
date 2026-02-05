import { ModuleRegistry } from './core/module/ModuleRegistry'
import { InMemoryEventBus } from './core/context/InMemoryEventBus'
import { PhotoFeedModule } from './modules/photo-feed'
import { CoreContext } from './core/context/CoreContext'

async function bootstrap() {
  const context: CoreContext = {
    events: new InMemoryEventBus(),
    storage: {} as any,
    permission: {} as any,
    logger: console,
    config: {
      environment: 'test',
      version: '0.1.0',
    },
  }

  const registry = new ModuleRegistry(context)

  const photoFeed = new PhotoFeedModule()

  registry.register(photoFeed)
  await registry.init(photoFeed.id)
  await registry.activate(photoFeed.id)

  const service = photoFeed.getService()

  service.addPhoto('https://example.com/photo1.jpg')
  service.addPhoto('https://example.com/photo2.jpg')

  console.log(service.listPhotos())
}

bootstrap().catch(err => {
  console.error('Bootstrap failed:', err)
})
