// bootstrap.ts
import { ModuleRegistry } from './packages/core/module/ModuleRegistry.js'
import { InMemoryEventBus } from './packages/core/context/InMemoryEventBus.js'
import { PhotoFeedModule } from './packages/photo-feed/PhotoFeedModule.js'
import { CoreContext } from './packages/core/context/CoreContext.js'
import { RuntimeLoggerModule } from './packages/runtime-logger/RuntimeLoggerModule.js'
import { CoreEventMap } from './packages/core/context/CoreEventMap.js'
import { LocalStorageAdapter } from './packages/core/infraestructure/LocalStorageAdapter.js'

async function bootstrap() {
  const eventBus = new InMemoryEventBus<CoreEventMap>()
  // Instancia del adaptador real
  const storage = new LocalStorageAdapter('v0.2.0_');
  const context: CoreContext<CoreEventMap> = {
  events: eventBus,
      storage,                                        // Se inyecta el adaptador real
      permission: {
        has: (permission) => true,
        request: async (permission) => true
      },
      logger: console,
      config: {
        environment: 'development',
        version: '0.2.0',
      },
    }

  const registry = new ModuleRegistry(context)
  const runtimeLogger = new RuntimeLoggerModule()

  // Inicializar el Logger antes del registro
  await runtimeLogger.init(context)

  // A partir de aqui el orden sera determinista
  registry.register(runtimeLogger)          // Emitira REGISTER (runtimeLogger)
  await registry.init(runtimeLogger.id)     // Emitira INTIALIZED (runtimeLogger)
  await registry.activate(runtimeLogger.id) // Emitira ACTIVATE (RuntimeLogger)

  const photoFeed = new PhotoFeedModule()
  registry.register(photoFeed)              // Emitira REGISTERES (photoFeed)
  await registry.init(photoFeed.id)
  await registry.activate(photoFeed.id)

  photoFeed.addPhoto('https://example.com/photo1.jpg')
  photoFeed.addPhoto('https://example.com/photo2.jpg')

  console.log('Photos Initialized: ', photoFeed.listEntries())
}

bootstrap().catch(err => {
  console.error('Bootstrap failer: ', err)
})