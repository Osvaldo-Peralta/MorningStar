// Refresh tokens: rotación completa + detección de reuso (ADR-0009)
import { describe, it, expect, beforeEach } from 'vitest'
import { AuthenticationModule, SESSION_DEFAULTS } from '../AuthenticationModule.js'
import { Pbkdf2PasswordHasher } from '../infraestructure/Pbkdf2PasswordHasher.js'
import { hashOpaqueToken } from '../infraestructure/sessionToken.js'
import { InvalidRefreshTokenError, RefreshTokenReuseError, AccountNotActiveError } from '../errors.js'
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

describe('AuthenticationModule — refresh tokens', () => {
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

  const makeAuth = (sessionOptions?: { accessTokenTtlMs?: number; refreshTokenTtlMs?: number }) =>
    new AuthenticationModule({
      passwordHasher: new Pbkdf2PasswordHasher({ iterations: 1000 }),
      userDirectory: directory(identity),
      session: sessionOptions,
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

  const activeUser = async (username = 'refresh1') => {
    const user = await identity.registerUser({
      username,
      email: `${username}@test.dev`,
      displayName: 'Refresh User',
    })
    await identity.requestEmailVerification(user.id)
    await identity.confirmEmail(delivery.outbox.at(-1)!.body.match(/token=([A-Za-z0-9_-]+)/)![1]!)
    await auth.setPassword(user.id, PASSWORD)
    return user
  }

  it('login emite refresh token persistido solo como hash', async () => {
    const user = await activeUser()
    const result = await auth.login('refresh1', PASSWORD, { fingerprint: 'dev-1' })

    expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]+$/)

    const records = await persistence
      .repository<{ id: string; userId: string; sessionId: string }>('auth:refresh-tokens')
      .list()
    expect(records).toHaveLength(1)
    expect(records[0]!.id).toBe(await hashOpaqueToken(result.refreshToken))
    expect(records[0]!.userId).toBe(user.id)
    expect(records[0]!.sessionId).toBe(result.session.sessionId)
    expect(JSON.stringify(records[0])).not.toContain(result.refreshToken)
  })

  it('refresh rota el par completo: sesión y token nuevos, anteriores inutilizados', async () => {
    await activeUser()
    const first = await auth.login('refresh1', PASSWORD, { fingerprint: 'dev-1' })

    const second = await auth.refresh(first.refreshToken)

    // Nuevo par
    expect(second.session.token).not.toBe(first.session.token)
    expect(second.refreshToken).not.toBe(first.refreshToken)
    expect(second.session.sessionId).not.toBe(first.session.sessionId)
    expect(second.session.deviceFingerprint).toBe('dev-1') // hereda el dispositivo

    // Access anterior revocado (rotated); nuevo válido
    expect(await auth.validateSession(first.session.token)).toBeNull()
    expect(await auth.validateSession(second.session.token)).not.toBeNull()

    // Eventos
    expect(emitted.some((e) => e.name === 'auth:token-refreshed')).toBe(true)
    const revoked = emitted.find((e) => e.name === 'auth:session-revoked')
    expect(revoked?.payload).toMatchObject({ reason: 'rotated' })
  })

  it('detección de reuso: RT consumido revoca la sesión y emite señal de seguridad', async () => {
    await activeUser()
    const first = await auth.login('refresh1', PASSWORD)
    const second = await auth.refresh(first.refreshToken)

    // El atacante (o un cliente desincronizado) reapresenta el RT viejo
    await expect(auth.refresh(first.refreshToken)).rejects.toThrow(RefreshTokenReuseError)

    // La sesión del par nuevo fue revocada como medida defensiva
    expect(await auth.validateSession(second.session.token)).toBeNull()

    const reuse = emitted.find((e) => e.name === 'auth:refresh-reuse-detected')
    expect(reuse?.payload).toMatchObject({ sessionId: second.session.sessionId })
  })

  it('refresh con token desconocido o de sesión revocada: InvalidRefreshTokenError', async () => {
    await activeUser()
    const result = await auth.login('refresh1', PASSWORD)

    await expect(auth.refresh('token-inventado')).rejects.toThrow(InvalidRefreshTokenError)

    // Logout de la sesión ⇒ su refresh ya no sirve
    await auth.logout(result.session.token)
    await expect(auth.refresh(result.refreshToken)).rejects.toThrow(InvalidRefreshTokenError)
  })

  it('refresh con RT expirado: InvalidRefreshTokenError (TTL inyectable)', async () => {
    await activeUser('expiring')
    const shortAuth = makeAuth({ refreshTokenTtlMs: 30 })
    await shortAuth.init(context)

    const result = await shortAuth.login('expiring', PASSWORD)
    await new Promise((resolve) => setTimeout(resolve, 50))

    await expect(shortAuth.refresh(result.refreshToken)).rejects.toThrow(InvalidRefreshTokenError)
  })

  it('refresh revalida el estado de la cuenta: SUSPENDED no puede refrescar', async () => {
    const user = await activeUser('suspending')
    const result = await auth.login('suspending', PASSWORD)

    await identity.changeStatus(user.id, 'SUSPENDED', 'moderación')

    await expect(auth.refresh(result.refreshToken)).rejects.toThrow(AccountNotActiveError)
    await expect(auth.refresh(result.refreshToken)).rejects.toThrow(/SUSPENDED/)
  })

  it('defaults: access 60 min, refresh 30 días', () => {
    expect(SESSION_DEFAULTS.accessTokenTtlMs).toBe(3_600_000)
    expect(SESSION_DEFAULTS.refreshTokenTtlMs).toBe(2_592_000_000)
  })
})
