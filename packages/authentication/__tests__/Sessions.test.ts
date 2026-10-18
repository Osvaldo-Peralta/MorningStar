// Sesiones: emisión, validación, expiración, logout en 3 niveles, fingerprint (ADR-0008)
import { describe, it, expect, beforeEach } from 'vitest'
import { AuthenticationModule, SESSION_DEFAULTS } from '../AuthenticationModule.js'
import { Pbkdf2PasswordHasher } from '../infraestructure/Pbkdf2PasswordHasher.js'
import { hashOpaqueToken } from '../infraestructure/sessionToken.js'
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

describe('AuthenticationModule — sesiones', () => {
  let persistence: InMemoryPersistenceAdapter
  let bus: InMemoryEventBus<CoreEventMap>
  let delivery: InMemoryEmailDelivery
  let emitted: DomainEvent<unknown>[]
  let context: CoreContext<CoreEventMap>
  let identity: IdentityModule
  let auth: AuthenticationModule

  const directoryFromIdentity = (identityModule: IdentityModule): UserDirectoryPort => ({
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

  const makeAuth = (sessionOptions?: { accessTokenTtlMs?: number }) =>
    new AuthenticationModule({
      passwordHasher: new Pbkdf2PasswordHasher({ iterations: 1000 }),
      userDirectory: directoryFromIdentity(identity),
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

  const activeUser = async (username = 'sessuser') => {
    const user = await identity.registerUser({
      username,
      email: `${username}@test.dev`,
      displayName: 'Sess User',
    })
    await identity.requestEmailVerification(user.id)
    await identity.confirmEmail(delivery.outbox.at(-1)!.body.match(/token=([A-Za-z0-9_-]+)/)![1]!)
    await auth.setPassword(user.id, PASSWORD)
    return user
  }

  it('login emite sesión con token opaco y metadata de la Baseline', async () => {
    const user = await activeUser()
    const before = Date.now()

    const { session } = await auth.login('sessuser', PASSWORD, { fingerprint: 'device-A' })

    expect(session.token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(session.userId).toBe(user.id)
    expect(session.deviceFingerprint).toBe('device-A')
    expect(session.issuedAt).toBeGreaterThanOrEqual(before)
    expect(session.expiresAt).toBeGreaterThan(session.issuedAt)
    expect(session.riskSnapshot).toEqual({ riskLevel: 'UNKNOWN' }) // placeholder Fase 8
    expect(session.sessionId).toBe(await hashOpaqueToken(session.token))

    const issued = emitted.find((e) => e.name === 'auth:session-issued')
    expect(issued?.payload).toMatchObject({
      userId: user.id,
      sessionId: session.sessionId,
      deviceFingerprint: 'device-A',
    })
  })

  it('login sin device usa fingerprint "unknown"', async () => {
    await activeUser('nodevice')
    const { session } = await auth.login('nodevice', PASSWORD)
    expect(session.deviceFingerprint).toBe('unknown')
  })

  it('validateSession: roundtrip válido, null para token desconocido', async () => {
    const user = await activeUser()
    const { session } = await auth.login('sessuser', PASSWORD, { fingerprint: 'dev-1' })

    const info = await auth.validateSession(session.token)
    expect(info).toMatchObject({ userId: user.id, deviceFingerprint: 'dev-1' })
    expect(info?.lastSeenAt).toBeGreaterThanOrEqual(session.issuedAt)
    expect((info as unknown as { token?: string }).token).toBeUndefined() // nunca re-expone el token

    expect(await auth.validateSession('token-inventado')).toBeNull()
  })

  it('sesión expirada: validate devuelve null (TTL inyectable)', async () => {
    await activeUser('expiring')
    const shortAuth = makeAuth({ accessTokenTtlMs: 30 })
    await shortAuth.init(context)

    const { session } = await shortAuth.login('expiring', PASSWORD)
    expect(await shortAuth.validateSession(session.token)).not.toBeNull()

    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(await shortAuth.validateSession(session.token)).toBeNull()
  })

  it('logout revoca la sesión; segundo logout devuelve false', async () => {
    await activeUser()
    const { session } = await auth.login('sessuser', PASSWORD)

    expect(await auth.logout(session.token)).toBe(true)
    expect(await auth.validateSession(session.token)).toBeNull()
    expect(await auth.logout(session.token)).toBe(false)

    const revoked = emitted.find((e) => e.name === 'auth:session-revoked')
    expect(revoked?.payload).toMatchObject({ sessionId: session.sessionId, reason: 'logout' })
  })

  it('logoutUser revoca solo las sesiones de ese usuario', async () => {
    const target = await activeUser('multi01')
    await activeUser('other001')

    await auth.login('multi01', PASSWORD, { fingerprint: 'dev-1' })
    await auth.login('multi01', PASSWORD, { fingerprint: 'dev-2' })
    const otherSession = await auth.login('other001', PASSWORD)

    const count = await auth.logoutUser(target.id)
    expect(count).toBe(2)
    expect(await auth.listSessions(target.id)).toHaveLength(0)

    // Las del otro usuario siguen vivas
    expect(await auth.validateSession(otherSession.session.token)).not.toBeNull()
  })

  it('invalidateAllSessions: primitiva ACTIVE_DEFENSE revoca todo y emite evento agregado', async () => {
    await activeUser('victim01')
    await activeUser('victim02')
    const s1 = await auth.login('victim01', PASSWORD)
    const s2 = await auth.login('victim02', PASSWORD)

    const count = await auth.invalidateAllSessions('ACTIVE_DEFENSE drill')
    expect(count).toBe(2)
    expect(await auth.validateSession(s1.session.token)).toBeNull()
    expect(await auth.validateSession(s2.session.token)).toBeNull()

    const invalidated = emitted.find((e) => e.name === 'auth:sessions-invalidated')
    expect(invalidated?.payload).toMatchObject({ count: 2, reason: 'ACTIVE_DEFENSE drill' })
  })

  it('listSessions expone dispositivos activos sin tokens', async () => {
    const user = await activeUser('lister01')
    await auth.login('lister01', PASSWORD, { fingerprint: 'phone' })
    await auth.login('lister01', PASSWORD, { fingerprint: 'laptop' })

    const sessions = await auth.listSessions(user.id)
    expect(sessions).toHaveLength(2)
    expect(sessions.map((s) => s.deviceFingerprint).sort()).toEqual(['laptop', 'phone'])
    for (const s of sessions) {
      expect(JSON.stringify(s)).not.toContain('"token"')
    }
  })

  it('el token en claro NUNCA se persiste: el record vive bajo su hash', async () => {
    const user = await activeUser()
    const { session } = await auth.login('sessuser', PASSWORD)

    const records = await persistence
      .repository<{ id: string; userId: string }>('auth:sessions')
      .list()
    expect(records).toHaveLength(1)
    expect(records[0]!.id).toBe(await hashOpaqueToken(session.token))
    expect(records[0]!.id).not.toBe(session.token)
    expect(JSON.stringify(records[0])).not.toContain(session.token)
    expect(records[0]!.userId).toBe(user.id)
  })

  it('las sesiones sobreviven a una reinicialización (persistidas por hash)', async () => {
    await activeUser()
    const { session } = await auth.login('sessuser', PASSWORD, { fingerprint: 'dev-x' })

    const second = makeAuth()
    await second.init(context)

    const info = await second.validateSession(session.token)
    expect(info).toMatchObject({ deviceFingerprint: 'dev-x' })
  })

  it('TTL por defecto: 60 minutos', () => {
    expect(SESSION_DEFAULTS.accessTokenTtlMs).toBe(3_600_000)
  })
})
