// Integración authentication + identity a través del UserDirectoryPort (ADR-0007)
import { describe, it, expect, beforeEach } from 'vitest'
import { AuthenticationModule, LOCKOUT_DEFAULTS } from '../AuthenticationModule.js'
import { Pbkdf2PasswordHasher } from '../infraestructure/Pbkdf2PasswordHasher.js'
import { validatePassword, PASSWORD_POLICY } from '../domain/PasswordPolicy.js'
import {
  AccountLockedError,
  AccountNotActiveError,
  InvalidCredentialsError,
  InvalidPasswordError,
  MissingCredentialsError,
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

const PASSWORD = 'ClaveSegura123!'

describe('AuthenticationModule', () => {
  let persistence: InMemoryPersistenceAdapter
  let bus: InMemoryEventBus<CoreEventMap>
  let delivery: InMemoryEmailDelivery
  let emitted: DomainEvent<unknown>[]
  let context: CoreContext<CoreEventMap>
  let identity: IdentityModule
  let auth: AuthenticationModule

  /** Adaptador de directorio: lo que haría la composición real (bootstrap/backend). */
  const directoryFromIdentity = (identityModule: IdentityModule): UserDirectoryPort => ({
    lookupUser: async (identifier) => {
      const user =
        (await identityModule.getByUsername(identifier)) ??
        (await identityModule.getByEmail(identifier))
      return user ? { userId: user.id, accountStatus: user.accountStatus } : null
    },
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

    auth = new AuthenticationModule({
      passwordHasher: new Pbkdf2PasswordHasher({ iterations: 1000 }), // rápido en tests
      userDirectory: directoryFromIdentity(identity),
      lockout: { maxFailedAttempts: 3, durationMs: 60 }, // lockout corto y determinista
    })
    await auth.init(context)
  })

  /** Registra + verifica email (queda ACTIVE) + setPassword. */
  const activeUserWithPassword = async (username = 'osvaldo42', password = PASSWORD) => {
    const user = await identity.registerUser({
      username,
      email: `${username}@test.dev`,
      displayName: 'Osvaldo',
    })
    await identity.requestEmailVerification(user.id)
    const token = delivery.outbox.at(-1)!.body.match(/token=([A-Za-z0-9_-]+)/)![1]!
    await identity.confirmEmail(token)
    await auth.setPassword(user.id, password)
    return user
  }

  it('constructor exige passwordHasher y userDirectory', () => {
    expect(
      () => new AuthenticationModule({} as never)
    ).toThrow(/passwordHasher/)
    expect(
      () => new AuthenticationModule({ passwordHasher: new Pbkdf2PasswordHasher({ iterations: 1 }) } as never)
    ).toThrow(/userDirectory/)
  })

  it("init falla con error explícito si falta context.persistence", async () => {
    const module = new AuthenticationModule({
      passwordHasher: new Pbkdf2PasswordHasher({ iterations: 1 }),
      userDirectory: directoryFromIdentity(identity),
    })
    const { persistence: _drop, ...withoutPersistence } = context
    await expect(module.init(withoutPersistence as CoreContext<CoreEventMap>)).rejects.toThrow(/persistence/)
  })

  it('setPassword + login exitoso por username devuelve userId + sesión y emite eventos', async () => {
    const user = await activeUserWithPassword()

    const result = await auth.login('osvaldo42', PASSWORD)
    expect(result.userId).toEqual(user.id)
    expect(result.session.token).toBeTruthy()
    expect(result.session.userId).toBe(user.id)

    expect(emitted.some((e) => e.name === 'auth:password-set')).toBe(true)
    const success = emitted.find((e) => e.name === 'auth:login-succeeded')
    expect(success?.payload).toMatchObject({ userId: user.id })
  })

  it('login exitoso por email (case-insensitive)', async () => {
    const user = await activeUserWithPassword('maillogin')

    const result = await auth.login('  MAILLOGIN@TEST.DEV ', PASSWORD)
    expect(result.userId).toBe(user.id)
  })

  it('anti-enumeración: usuario inexistente, sin credenciales y clave incorrecta producen el MISMO error', async () => {
    await activeUserWithPassword('target01')
    const sinPassword = await identity.registerUser({
      username: 'nocreds01',
      email: 'nocreds01@test.dev',
      displayName: 'Sin Clave',
    })
    await identity.requestEmailVerification(sinPassword.id)
    await identity.confirmEmail(delivery.outbox.at(-1)!.body.match(/token=([A-Za-z0-9_-]+)/)![1]!)

    const casos = [
      auth.login('usuario-fantasma', PASSWORD),          // no existe
      auth.login('nocreds01', PASSWORD),                 // existe, sin credenciales
      auth.login('target01', 'clave-incorrecta'),        // existe, clave mala
    ]

    const errores = await Promise.all(casos.map((p) => p.catch((e: Error) => e)))
    for (const error of errores) {
      expect(error).toBeInstanceOf(InvalidCredentialsError)
      expect(error.message).toBe('Invalid credentials')
    }
  })

  it('lockout: tras N fallos consecutivos la cuenta se bloquea (incluso con clave correcta)', async () => {
    const user = await activeUserWithPassword('lockable')

    // Fallos 1 y 2: error genérico (anti-enumeración)
    await expect(auth.login('lockable', 'mala')).rejects.toThrow(InvalidCredentialsError)
    await expect(auth.login('lockable', 'mala')).rejects.toThrow(InvalidCredentialsError)

    // Fallo 3 (== maxFailedAttempts): activa el lockout de inmediato
    await expect(auth.login('lockable', 'mala')).rejects.toThrow(AccountLockedError)
    expect(emitted.some((e) => e.name === 'auth:account-locked')).toBe(true)

    // Incluso con la contraseña correcta: bloqueada durante el lockout
    await expect(auth.login('lockable', PASSWORD)).rejects.toThrow(AccountLockedError)

    // Tras expirar el lockout (60 ms en la fixture), el login correcto pasa y resetea contadores
    await new Promise((resolve) => setTimeout(resolve, 80))
    const result = await auth.login('lockable', PASSWORD)
    expect(result.userId).toBe(user.id)
  })

  it('un login exitoso resetea el contador de fallos previos', async () => {
    await activeUserWithPassword('resetable')

    await expect(auth.login('resetable', 'mala')).rejects.toThrow(InvalidCredentialsError)
    await expect(auth.login('resetable', 'mala')).rejects.toThrow(InvalidCredentialsError)
    await auth.login('resetable', PASSWORD) // reset

    // Otros 2 fallos no bloquean (el contador volvió a 0)
    await expect(auth.login('resetable', 'mala')).rejects.toThrow(InvalidCredentialsError)
    await expect(auth.login('resetable', 'mala')).rejects.toThrow(InvalidCredentialsError)
    await expect(auth.login('resetable', PASSWORD)).resolves.toBeDefined()
  })

  it('solo ACTIVE puede loguearse: PENDING_VERIFICATION recibe AccountNotActiveError (post-credenciales)', async () => {
    const pending = await identity.registerUser({
      username: 'pending01',
      email: 'pending01@test.dev',
      displayName: 'Pending',
    })
    await auth.setPassword(pending.id, PASSWORD)

    await expect(auth.login('pending01', PASSWORD)).rejects.toThrow(AccountNotActiveError)
    await expect(auth.login('pending01', PASSWORD)).rejects.toThrow(/PENDING_VERIFICATION/)

    // Con clave incorrecta NO se revela el estado (anti-enumeración)
    await expect(auth.login('pending01', 'mala')).rejects.toThrow(InvalidCredentialsError)
  })

  it('cuenta SUSPENDED con clave correcta: AccountNotActiveError con reason', async () => {
    const user = await activeUserWithPassword('suspended1')
    await identity.changeStatus(user.id, 'SUSPENDED', 'moderación')

    await expect(auth.login('suspended1', PASSWORD)).rejects.toThrow(/SUSPENDED/)
    const failed = emitted.filter((e) => e.name === 'auth:login-failed').at(-1)
    expect(failed?.payload).toMatchObject({ reason: 'account-not-active', accountStatus: 'SUSPENDED' })
  })

  it('changePassword: exige la actual, rota el hash y emite auth:password-changed', async () => {
    const user = await activeUserWithPassword('rotating')

    await expect(auth.changePassword(user.id, 'actual-mala', 'NuevaClave456!')).rejects.toThrow(
      InvalidCredentialsError
    )

    await auth.changePassword(user.id, PASSWORD, 'NuevaClave456!')

    await expect(auth.login('rotating', PASSWORD)).rejects.toThrow(InvalidCredentialsError)
    await expect(auth.login('rotating', 'NuevaClave456!')).resolves.toMatchObject({ userId: user.id })
    expect(emitted.some((e) => e.name === 'auth:password-changed')).toBe(true)
  })

  it('changePassword sobre usuario sin credenciales lanza MissingCredentialsError', async () => {
    await expect(auth.changePassword('ghost', 'a', 'NuevaClave456!')).rejects.toThrow(
      MissingCredentialsError
    )
  })

  it('setPassword aplica la política (mín 8, máx 128) sin persistir nada si falla', async () => {
    const user = await activeUserWithPassword('policy01')

    await expect(auth.setPassword(user.id, 'corta')).rejects.toThrow(InvalidPasswordError)
    await expect(auth.setPassword(user.id, 'x'.repeat(PASSWORD_POLICY.maxLength + 1))).rejects.toThrow(/at most/)

    // La contraseña original sigue funcionando
    await expect(auth.login('policy01', PASSWORD)).resolves.toBeDefined()
  })

  it('validatePassword acepta/rechaza según política y admite overrides', () => {
    expect(() => validatePassword('valida123')).not.toThrow()
    expect(() => validatePassword('corta')).toThrow(InvalidPasswordError)
    expect(() => validatePassword('ok', { minLength: 2 })).not.toThrow()
    expect(() => validatePassword('demasiado-larga', { maxLength: 5 })).toThrow(InvalidPasswordError)
  })

  it('las credenciales sobreviven a una reinicialización (hash persistido, claro nunca)', async () => {
    const user = await activeUserWithPassword('durable01')

    const second = new AuthenticationModule({
      passwordHasher: new Pbkdf2PasswordHasher({ iterations: 1000 }),
      userDirectory: directoryFromIdentity(identity),
    })
    await second.init(context)

    await expect(second.login('durable01', PASSWORD)).resolves.toMatchObject({ userId: user.id })

    // El almacén solo contiene el hash auto-descriptivo
    const records = await persistence.repository<{ id: string; passwordHash: string }>('auth:credentials').list()
    expect(records).toHaveLength(1)
    expect(records[0]!.passwordHash).toMatch(/^pbkdf2-sha256\$/)
    expect(records[0]!.passwordHash).not.toContain(PASSWORD)
  })

  it('los defaults de lockout son 5 intentos / 15 minutos', () => {
    expect(LOCKOUT_DEFAULTS).toEqual({ maxFailedAttempts: 5, durationMs: 900_000 })
  })
})
