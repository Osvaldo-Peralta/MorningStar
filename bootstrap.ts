// bootstrap.ts
import { ModuleRegistry } from './core/module/ModuleRegistry'
import { InMemoryEventBus } from './core/context/InMemoryEventBus'
import { PhotoFeedModule } from './modules/photo-feed'
import { CoreContext } from './core/context/CoreContext'
import { RuntimeLoggerModule } from './modules/runtime-logger/RuntimeLoggerModule'
import { CoreEventMap } from './core/context/CoreEventMap'

async function bootstrap() {
  // 1. Instanciamos el Bus con el mapa de eventos del Core
  const eventBus = new InMemoryEventBus<CoreEventMap>()

  const context: CoreContext<CoreEventMap> = {
    events: eventBus,
    // 2. Mocks mínimos funcionales para evitar errores de ejecución
    storage: {
      get: async () => null,
      set: async () => {},
      remove: async () => {},
      exists: async () => false
    },
    permission: {
      has: () => true,
      request: async () => true
    },
    logger: console,
    config: {
      environment: 'development', // Cambiado de 'test' para un flujo real
      version: '0.1.0',
    },
  }

  // 3. El Registro usará el contexto tipado
  const registry = new ModuleRegistry(context)

  // 4. Registro y Activación del Logger (Observabilidad)
  const runtimeLogger = new RuntimeLoggerModule()
  registry.register(runtimeLogger)
  await registry.init(runtimeLogger.id)
  await registry.activate(runtimeLogger.id)

  // 5. Registro y Activación de PhotoFeed
  const photoFeed = new PhotoFeedModule()
  registry.register(photoFeed)
  await registry.init(photoFeed.id)
  await registry.activate(photoFeed.id)

  // 6. Uso del módulo
  photoFeed.addPhoto('https://example.com/photo1.jpg')
  
  // Imprimimos el estado para verificar
  console.log('Photos initialized:', photoFeed.listPhotos())
}

bootstrap().catch(err => {
  console.error('Bootstrap failed:', err)
})