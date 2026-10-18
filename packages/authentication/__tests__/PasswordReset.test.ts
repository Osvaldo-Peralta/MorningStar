// Reset de contraseña self-service por email (ADR-0009)
import { describe, it, expect, beforeEach } from 'vitest'
import { AuthenticationModule, PASSWORD_RESET_DEFAULTS } from '../AuthenticationModule.js'
import { Pbkdf2PasswordHasher } from '../infraestructure/Pbkdf2PasswordHasher.js'
import {
  InvalidResetTokenError,
  ResetTokenAlreadyUsedError,
  ResetTokenExpiredError,
  ResetTokenInvalidatedError,
} from '../errors.js'
import { IdentityModule } from '@morningstar/identity'
import {
  InMemoryEmailDelivery,
  InMemoryEventBus,
  InMemoryPersistenceAdapter,
} from '@morningstar/core'
import type { CoreContext, CoreEventMap, DomainEvent, Storage } from '@morningstar/core'
import type { UserDirectoryPort } from '../UserDirectoryPort.js'

const nullStorage: Storage = {
  get: async () => null,
  set: async () => {},
  remove: async () => {},
  exists: async () => false,
}

const OLD_PASSWORD = 'ClaveSegura123!'
const NEW_PASSWORD = 'NuevaClave456!'

const resetTokenFromLastEmail = (delivery: InMemoryEmailDelivery): string => {
  const email = delivery.outbox.at(-1)!
  return email.body.match(/token=([A-Za-z0-9_-]+)/)![1]!
}

describe('AuthenticationModule — reset de contraseña', () => {
  let persistence: InMemoryPersistenceAdapter
  let bus: InMemoryEventBus<CoreEventMap>
  let delivery: InMemoryEmailDelivery
  let emitted: DomainEvent<unknown>[]
  let context: CoreContext<CoreEventMap>
  let identity: IdentityModule
  let auth: AuthenticationModule

  const directory: (m: IdentityModule) => UserDirectoryPort = (identityModule) => ({
    lookupUser: async (identifier) => {
      const user =
        (await identityModule.getByUsername(identifier)) ??
        (await identityModule.getByEmail(identifier))
      return user
        ? { userId: user.id, accountStatus: user.accountStatus, email: user.email }
        : null
    },
    getUserAccount: async (userId) => {
      const user = await identityModule.getUser(userId)
      return user
        ? { userId: user.id, accountStatus: user.accountStatus, email: user.email }
        : null
    },
  })

  const makeAuth = (resetOptions?: { tokenTtlMs?: number }) =>
    new AuthenticationModule({
      passwordHasher: new Pbkdf2PasswordHasher({ iterations: 1000 }),
      userDirectory: directory(identity),
      passwordReset: resetOptions,
    })

  beforeEach(async () => {
    persistence = new InMemoryPersistenceAdapter()
    bus = new InMemoryEventBus<CoreEventMap>()
    delivery = new InMemoryEmailDelivery()
    emitted = []
    bus.on('*', (event) => emitted.push(event))

    context = {
      events: bus,
      storage: nullStorage,
      persistence,
      email: delivery,
      permission: { has: () => true, request: async () => true },
      logger: console,
      config: { environment: 'test', version: '0.0.0' },
    }

    identity = new IdentityModule()
    await identity.init(context)
    auth = makeAuth()
    await auth.init(context)
  })

  const activeUser = async (username = 'resetuser') => {
    const user = await identity.registerUser({
      username,
      email: `${username}@test.dev`,
      displayName: 'Reset User',
    })
    await identity.requestEmailVerification(user.id)
    await identity.confirmEmail(
      delivery.outbox.at(-1)!.body.match(/token=([A-Za-z0-9_-]+)/)![1]!
    )
    await auth.setPassword(user.id, OLD_PASSWORD)
    return user
  }

  it('request envía email con enlace y emite auth:password-reset-requested', async () => {
    const user = await activeUser()
    await auth.requestPasswordReset('resetuser')

    const email = delivery.outbox.at(-1)!
    expect(email.to).toBe('resetuser@test.dev')
    expect(email.body).toMatch(/token=/)
    expect(email.subject).toMatch(/Restablece/)

    const event = emitted.find((e) => e.name === 'auth:password-reset-requested')
    expect(event?.payload).toMatchObject({ userId: user.id })
  })

  it('anti-enumeración: identifier inexistente no revela nada (mismo resultado, sin email)', async () => {
    await activeUser()
    const emailsBefore = delivery.outbox.length

    // Ambos resuelven igual (void), pero solo el existente envía email
    await expect(auth.requestPasswordReset('usuario-fantasma')).resolves.toBeUndefined()
    expect(delivery.outbox).toHaveLength(emailsBefore)

    const event = emitted.filter((e) => e.name === 'auth:password-reset-requested').at(-1)
    expect(event?.payload).toEqual({}) // sin userId
  })

  it('una nueva solicitud invalida el token anterior', async () => {
    await activeUser()
    await auth.requestPasswordReset('resetuser')
    const oldToken = resetTokenFromLastEmail(delivery)

    await auth.requestPasswordReset('resetuser')
    const newToken = resetTokenFromLastEmail(delivery)
    expect(newToken).not.toBe(oldToken)

    await expect(auth.resetPassword(oldToken, NEW_PASSWORD)).rejects.toThrow(ResetTokenInvalidatedError)
    await expect(auth.resetPassword(newToken, NEW_PASSWORD)).resolves.toBeUndefined()
  })

  it('flujo completo: reset rota la contraseña y revoca TODAS las sesiones', async () => {
    const user = await activeUser()
    const s1 = await auth.login('resetuser', OLD_PASSWORD, { fingerprint: 'phone' })
    const s2 = await auth.login('resetuser', OLD_PASSWORD, { fingerprint: 'laptop' })

    await auth.requestPasswordReset('resetuser')
    const token = resetTokenFromLastEmail(delivery)
    await auth.resetPassword(token, NEW_PASSWORD)

    // Contraseña rota
    await expect(auth.login('resetuser', OLD_PASSWORD)).rejects.toThrow()
    await expect(auth.login('resetuser', NEW_PASSWORD)).resolves.toBeDefined()

    // Sesiones anteriores revocadas (el atacante con sesión robada pierde acceso)
    expect(await auth.validateSession(s1.session.token)).toBeNull()
    expect(await auth.validateSession(s2.session.token)).toBeNull()

    const event = emitted.find((e) => e.name === 'auth:password-reset')
    expect(event?.payload).toMatchObject({ userId: user.id, sessionsRevoked: 2 })
  })

  it('single-use: token consumido lanza ResetTokenAlreadyUsedError', async () => {
    await activeUser()
    await auth.requestPasswordReset('resetuser')
    const token = resetTokenFromLastEmail(delivery)

    await auth.resetPassword(token, NEW_PASSWORD)
    await expect(auth.resetPassword(token, 'OtraClave789!')).rejects.toThrow(ResetTokenAlreadyUsedError)
  })

  it('token expirado lanza ResetTokenExpiredError (TTL inyectable)', async () => {
    await activeUser('expiring')
    const shortAuth = makeAuth({ tokenTtlMs: 30 })
    await shortAuth.init(context)

    await shortAuth.requestPasswordReset('expiring')
    const token = resetTokenFromLastEmail(delivery)

    await new Promise((resolve) => setTimeout(resolve, 50))
    await expect(shortAuth.resetPassword(token, NEW_PASSWORD)).rejects.toThrow(ResetTokenExpiredError)

    // La contraseña NO cambió
    await expect(shortAuth.login('expiring', OLD_PASSWORD)).resolves.toBeDefined()
  })

  it('token inexistente lanza InvalidResetTokenError', async () => {
    await expect(auth.resetPassword('token-fantasma', NEW_PASSWORD)).rejects.toThrow(InvalidResetTokenError)
  })

  it('contraseña inválida no quema el token (política antes de consumir)', async () => {
    await activeUser()
    await auth.requestPasswordReset('resetuser')
    const token = resetTokenFromLastEmail(delivery)

    await expect(auth.resetPassword(token, 'corta')).rejects.toThrow()

    // El token sigue usable con una contraseña válida
    await expect(auth.resetPassword(token, NEW_PASSWORD)).resolves.toBeUndefined()
  })

  it('changePassword también revoca las sesiones del usuario (ADR-0009)', async () => {
    const user = await activeUser('changer01')
    const session = await auth.login('changer01', OLD_PASSWORD)

    await auth.changePassword(user.id, OLD_PASSWORD, NEW_PASSWORD)

    expect(await auth.validateSession(session.session.token)).toBeNull()
    const event = emitted.find((e) => e.name === 'auth:password-changed')
    expect(event?.payload).toMatchObject({ userId: user.id, sessionsRevoked: 1 })
  })

  it('request sin context.email falla con error explícito', async () => {
    await activeUser()
    const module = makeAuth()
    const { email: _drop, ...withoutEmail } = context
    await module.init(withoutEmail as CoreContext<CoreEventMap>)

    await expect(module.requestPasswordReset('resetuser')).rejects.toThrow(/context\.email/)
  })

  it('TTL por defecto del token de reset: 1 hora', () => {
    expect(PASSWORD_RESET_DEFAULTS.tokenTtlMs).toBe(3_600_000)
  })
})
