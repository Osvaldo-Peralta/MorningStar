// bootstrap.ts
// Punto de entrada del backend (Node ESM).
// Consume únicamente las APIs públicas de cada paquete (contratos),
// nunca rutas internas: `@morningstar/*`.
import type { CoreContext, CoreEventMap } from '@morningstar/core'
import {
  InMemoryEmailDelivery,
  InMemoryEventBus,
  InMemoryPersistenceAdapter,
  InMemoryStorageAdapter,
  ModuleRegistry,
} from '@morningstar/core'
import { PhotoFeedModule } from '@morningstar/photo-feed'
import { RuntimeLoggerModule } from '@morningstar/runtime-logger'
import { IdentityModule } from '@morningstar/identity'

async function bootstrap() {
  const eventBus = new InMemoryEventBus<CoreEventMap>()
  // Adaptador volátil: en Node no existe `localStorage`.
  // Cuando llegue la Fase 1 (persistencia remota) se sustituirá
  // por el adaptador correspondiente sin tocar el dominio.
  const storage = new InMemoryStorageAdapter('v0.3.0_')
  const emailDelivery = new InMemoryEmailDelivery()

  const context: CoreContext<CoreEventMap> = {
    events: eventBus,
    storage,                                        // Se inyecta el adaptador
    // Persistencia con identidad estable (ADR-0003). En el backend de
    // producción será el adaptador remoto; aquí, volátil para la demo.
    persistence: new InMemoryPersistenceAdapter(),
    // Entrega de emails: en dev/test el outbox es inspeccionable (ADR-0006)
    email: emailDelivery,
    permission: {
      has: (permission) => true,
      request: async (permission) => true
    },
    logger: console,
    config: {
      environment: 'development',
      version: '0.3.0',
    },
  }

  const registry = new ModuleRegistry(context)
  const runtimeLogger = new RuntimeLoggerModule()

  // Inicializar el Logger antes del registro
  await runtimeLogger.init(context)

  // A partir de aqui el orden sera determinista
  registry.register(runtimeLogger)          // Emitira REGISTERED (runtimeLogger)
  await registry.init(runtimeLogger.id)     // Emitira INITIALIZED (runtimeLogger)
  await registry.activate(runtimeLogger.id) // Emitira ACTIVATED (runtimeLogger)

  const photoFeed = new PhotoFeedModule()
  registry.register(photoFeed)              // Emitira REGISTERED (photoFeed)
  await registry.init(photoFeed.id)
  await registry.activate(photoFeed.id)

  // Identity (Fase 3): ciclo completo registro → verificación → ACTIVE
  const identity = new IdentityModule()
  registry.register(identity)
  await registry.init(identity.id)
  await registry.activate(identity.id)

  const user = await identity.registerUser({
    username: 'OsvaldoDev',
    email: 'osvaldo@morningstar.dev',
    displayName: 'Osvaldo Peralta',
  })
  await identity.requestEmailVerification(user.id)

  // Dev/demo: extraemos el token del outbox del adaptador InMemory
  // (un usuario real lo recibiría por email y abriría el enlace)
  const verificationEmail = emailDelivery.outbox.at(-1)!
  const token = verificationEmail.body.match(/token=([A-Za-z0-9_-]+)/)![1]
  const verifiedUser = await identity.confirmEmail(token)
  console.log('User Verified: ', verifiedUser)

  await photoFeed.addPhoto('https://example.com/photo1.jpg')
  await photoFeed.addPhoto('https://example.com/photo2.jpg')

  console.log('Photos Initialized: ', photoFeed.listEntries())
}

bootstrap().catch(err => {
  console.error('Bootstrap failed: ', err)
  process.exitCode = 1
})
