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
import {
  AuthenticationModule,
  MfaRequiredError,
  Pbkdf2PasswordHasher,
  TotpService,
} from '@morningstar/authentication'

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
  console.log('User Verified: ', verifiedUser.accountStatus)

  // Authentication (Fase 4 / Iteración 6a): credenciales + login.
  // La composición cablea el UserDirectoryPort con identity (ADR-0002/0007):
  // authentication NO importa identity.
  const authentication = new AuthenticationModule({
    // Demo: iteraciones reducidas para un bootstrap rápido; en producción se
    // usa el default OWASP (600k).
    passwordHasher: new Pbkdf2PasswordHasher({ iterations: 100_000 }),
    userDirectory: {
      lookupUser: async (identifier) => {
        const user =
          (await identity.getByUsername(identifier)) ??
          (await identity.getByEmail(identifier))
        return user
          ? { userId: user.id, accountStatus: user.accountStatus, email: user.email }
          : null
      },
      getUserAccount: async (userId) => {
        const user = await identity.getUser(userId)
        return user
          ? { userId: user.id, accountStatus: user.accountStatus, email: user.email }
          : null
      },
    },
  })
  registry.register(authentication)
  await registry.init(authentication.id)
  await registry.activate(authentication.id)

  await authentication.setPassword(verifiedUser.id, 'SecurePass123!')
  const loginOk = await authentication.login(
    'osvaldodev',
    'SecurePass123!',
    { fingerprint: 'bootstrap-demo-device' }
  )
  console.log('Login OK (sesión): ', {
    userId: loginOk.userId,
    sessionId: loginOk.session.sessionId.slice(0, 12) + '…',
    expiresAt: new Date(loginOk.session.expiresAt).toISOString(),
  })

  const sessionInfo = await authentication.validateSession(loginOk.session.token)
  console.log('Sesión válida: ', sessionInfo?.deviceFingerprint)

  // Refresh con rotación completa (ADR-0009): par nuevo, anterior revocado
  const refreshed = await authentication.refresh(loginOk.refreshToken)
  console.log('Refresh OK: ', {
    nuevaSesión: refreshed.session.sessionId.slice(0, 12) + '…',
    anteriorRevocada: (await authentication.validateSession(loginOk.session.token)) === null,
  })

  try {
    await authentication.login('osvaldo@morningstar.dev', 'wrong-password')
  } catch (err) {
    console.log('Login rechazado (esperado): ', (err as Error).name)
  }

  await authentication.logout(refreshed.session.token)
  console.log('Logout: ', (await authentication.validateSession(refreshed.session.token)) === null)

  // MFA (Fase 4 / 6d): enrolamiento TOTP + login en dos pasos
  const mfaEnrollment = await authentication.enrollMfa(verifiedUser.id)
  const mfaCode = await new TotpService().generateCode(mfaEnrollment.secret)
  const mfaActivation = await authentication.confirmMfa(verifiedUser.id, mfaCode)
  console.log('MFA activo. Backup codes (entrega única): ', mfaActivation.backupCodes.length)

  try {
    await authentication.login('osvaldodev', 'SecurePass123!', { fingerprint: 'bootstrap-demo-device' })
    console.log('Inesperado: login sin segundo factor')
  } catch (err) {
    if (err instanceof MfaRequiredError) {
      // Segundo paso con backup code (determinista; el TOTP depende de la ventana de 30 s)
      const mfaLogin = await authentication.completeMfaLogin(
        err.mfaToken,
        mfaActivation.backupCodes[0]!
      )
      console.log('Login MFA OK (backup code), sesión: ', mfaLogin.session.sessionId.slice(0, 12) + '…')
      await authentication.logout(mfaLogin.session.token)
    }
  }

  await photoFeed.addPhoto('https://example.com/photo1.jpg')
  await photoFeed.addPhoto('https://example.com/photo2.jpg')

  console.log('Photos Initialized: ', photoFeed.listEntries())
}

bootstrap().catch(err => {
  console.error('Bootstrap failed: ', err)
  process.exitCode = 1
})
