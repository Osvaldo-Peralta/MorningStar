// bootstrap.ts
// Punto de entrada del backend (Node ESM).
// Consume únicamente las APIs públicas de cada paquete (contratos),
// nunca rutas internas: `@morningstar/*`.
//
// Orden de composición (ADR-0012):
// 1. infraestructura (adapters/bus)  2. instancias de módulos
// 3. CoreContext (incluye authorizer)  4. registro/init determinista
// 5. demos de cada fase del roadmap.
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
import { AuthorizationModule } from '@morningstar/authorization'

async function bootstrap() {
  // 1. Infraestructura
  const eventBus = new InMemoryEventBus<CoreEventMap>()
  const storage = new InMemoryStorageAdapter('v0.3.0_')
  const persistence = new InMemoryPersistenceAdapter()
  const emailDelivery = new InMemoryEmailDelivery()

  // 2. Módulos (instancias primero: la composición los referencia entre sí
  //    mediante puertos — ningún módulo importa a otro feature, ADR-0002)
  const runtimeLogger = new RuntimeLoggerModule()
  const photoFeed = new PhotoFeedModule()
  const identity = new IdentityModule()

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

  const authorization = new AuthorizationModule({
    sessionValidator: {
      validateSession: async (sessionToken) => {
        const session = await authentication.validateSession(sessionToken)
        return session
          ? {
              userId: session.userId,
              sessionId: session.sessionId,
              deviceFingerprint: session.deviceFingerprint,
              issuedAt: session.issuedAt,
              expiresAt: session.expiresAt,
              riskLevel: session.riskSnapshot.riskLevel,
            }
          : null
      },
    },
    actorDirectory: {
      getActor: async (userId) => {
        const user = await identity.getUser(userId)
        return user
          ? {
              accountStatus: user.accountStatus,
              accountType: user.accountType,
              verifiedAttributes: user.verificationFlags.emailVerified ? ['email'] : [],
            }
          : null
      },
    },
  })

  // 3. CoreContext: capabilities para todos los módulos
  const context: CoreContext<CoreEventMap> = {
    events: eventBus,
    storage,
    persistence,
    email: emailDelivery,
    // Enforcement de autorización en photo-feed (fail-closed con actor)
    authorizer: authorization,
    permission: {
      has: (permission) => true,
      request: async (permission) => true,
    },
    logger: console,
    config: {
      environment: 'development',
      version: '0.3.0',
    },
  }

  // 4. Registro e inicialización determinista
  const registry = new ModuleRegistry(context)

  await runtimeLogger.init(context) // El logger escucha antes del registro
  registry.register(runtimeLogger)
  await registry.init(runtimeLogger.id)
  await registry.activate(runtimeLogger.id)

  registry.register(photoFeed)
  await registry.init(photoFeed.id)
  await registry.activate(photoFeed.id)

  registry.register(identity)
  await registry.init(identity.id)
  await registry.activate(identity.id)

  registry.register(authentication)
  await registry.init(authentication.id)
  await registry.activate(authentication.id)

  registry.register(authorization)
  await registry.init(authorization.id)
  await registry.activate(authorization.id)

  // 5a. Identity (Fase 3): registro → verificación de email → ACTIVE
  const user = await identity.registerUser({
    username: 'OsvaldoDev',
    email: 'osvaldo@morningstar.dev',
    displayName: 'Osvaldo Peralta',
  })
  await identity.requestEmailVerification(user.id)
  const verificationEmail = emailDelivery.outbox.at(-1)!
  const verificationToken = verificationEmail.body.match(/token=([A-Za-z0-9_-]+)/)![1]
  const verifiedUser = await identity.confirmEmail(verificationToken)
  console.log('User Verified:', verifiedUser.accountStatus)

  // 5b. Authentication (Fase 4): credenciales → login → refresh → MFA
  await authentication.setPassword(verifiedUser.id, 'SecurePass123!')
  const loginOk = await authentication.login('osvaldodev', 'SecurePass123!', {
    fingerprint: 'bootstrap-demo-device',
  })
  console.log('Login OK (sesión):', loginOk.session.sessionId.slice(0, 12) + '…')

  const refreshed = await authentication.refresh(loginOk.refreshToken)
  const anteriorRevocada = (await authentication.validateSession(loginOk.session.token)) === null
  console.log('Refresh OK (rotación, anterior revocada):', anteriorRevocada)

  const mfaEnrollment = await authentication.enrollMfa(verifiedUser.id)
  const mfaCode = await new TotpService().generateCode(mfaEnrollment.secret)
  const mfaActivation = await authentication.confirmMfa(verifiedUser.id, mfaCode)
  console.log('MFA activo. Backup codes (entrega única):', mfaActivation.backupCodes.length)

  // Sesión vigente para las demos (login en dos pasos por MFA)
  let sessionToken = ''
  try {
    await authentication.login('osvaldodev', 'SecurePass123!', {
      fingerprint: 'bootstrap-demo-device',
    })
  } catch (err) {
    if (err instanceof MfaRequiredError) {
      const result = await authentication.completeMfaLogin(
        err.mfaToken,
        mfaActivation.backupCodes[0]!
      )
      sessionToken = result.session.token
      console.log('Login MFA OK (backup code), sesión:', result.session.sessionId.slice(0, 12) + '…')
    }
  }

  // 5c. Authorization (Fase 5): decisiones puras ALLOW/DENY/CONDITIONAL
  const actor = { sessionToken, userId: verifiedUser.id }
  const ownPhoto = {
    permission: 'photo:delete',
    resource: { type: 'photo', id: 'p1', ownerId: verifiedUser.id },
  }
  const foreignPhoto = {
    permission: 'photo:delete',
    resource: { type: 'photo', id: 'p2', ownerId: 'otro-usuario' },
  }
  console.log('member → borrar foto propia: ', (await authorization.authorize(ownPhoto, sessionToken)).decision)
  console.log('member → borrar foto ajena:  ', (await authorization.authorize(foreignPhoto, sessionToken)).decision)

  await authorization.assignRoles(verifiedUser.id, ['member', 'moderator'])
  console.log('moderator → borrar foto ajena:', (await authorization.authorize(foreignPhoto, sessionToken)).decision)

  await authorization.assignRoles(verifiedUser.id, ['member', 'moderator', 'admin'])
  const sensitive = await authorization.authorize({ permission: 'account:delete' }, sessionToken)
  console.log('admin → account:delete:       ', sensitive.decision, sensitive.conditions ?? [])

  // 5d. PhotoFeed con enforcement (7b): operaciones con actor y ownerId
  await photoFeed.addPhoto('https://example.com/photo1.jpg', actor)
  await photoFeed.addPhoto('https://example.com/photo2.jpg', actor)
  const [firstPhoto] = photoFeed.listEntries()
  console.log('Photo con owner:', { id: firstPhoto.id.slice(0, 8) + '…', ownerId: firstPhoto.ownerId?.slice(0, 8) + '…' })

  await photoFeed.editPhoto(firstPhoto.id, { url: 'https://example.com/photo1-edit.jpg' }, actor)
  console.log('Edit de foto propia (member, -own): ALLOW')

  try {
    await photoFeed.addPhoto('https://example.com/anonima.jpg') // sin actor
  } catch (err) {
    console.log('Operación sin actor rechazada (fail-closed):', (err as Error).name)
  }

  console.log('Photos Initialized:', photoFeed.listEntries().length)
}

bootstrap().catch(err => {
  console.error('Bootstrap failed: ', err)
  process.exitCode = 1
})
