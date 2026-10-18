// AuthorizationModule: ensamblado por puertos, authorize(), roles persistidos, eventos
import { describe, it, expect, beforeEach } from 'vitest'
import { AuthorizationModule } from '../AuthorizationModule.js'
import { UnknownRoleError, RoleNotAssignedError } from '../errors.js'
import {
  InMemoryEventBus,
  InMemoryPersistenceAdapter,
} from '@morningstar/core'
import type { CoreContext, CoreEventMap, DomainEvent, Storage } from '@morningstar/core'
import type { ActorDirectoryPort, SessionValidatorPort } from '../AuthorizationModule.js'

const nullStorage: Storage = {
  get: async () => null,
  set: async () => {},
  remove: async () => {},
  exists: async () => false,
}

const VALID_TOKEN = 'session-token-valida'
const USER_ID = 'user-42'

describe('AuthorizationModule', () => {
  let persistence: InMemoryPersistenceAdapter
  let bus: InMemoryEventBus<CoreEventMap>
  let emitted: DomainEvent<unknown>[]
  let context: CoreContext<CoreEventMap>
  let authz: AuthorizationModule

  // Puertos fake (la composición real usa authentication + identity)
  const sessionValidator: SessionValidatorPort = {
    validateSession: async (token) =>
      token === VALID_TOKEN
        ? {
            userId: USER_ID,
            sessionId: 'sess-1',
            deviceFingerprint: 'dev-1',
            issuedAt: 1,
            expiresAt: Number.MAX_SAFE_INTEGER,
            riskLevel: 'UNKNOWN',
          }
        : null,
  }

  let accountStatus = 'ACTIVE'
  const actorDirectory: ActorDirectoryPort = {
    getActor: async (userId) =>
      userId === USER_ID
        ? { accountStatus, accountType: 'PERSONAL', verifiedAttributes: ['email'] }
        : null,
  }

  beforeEach(async () => {
    persistence = new InMemoryPersistenceAdapter()
    bus = new InMemoryEventBus<CoreEventMap>()
    emitted = []
    bus.on('*', (event) => emitted.push(event))
    accountStatus = 'ACTIVE'

    context = {
      events: bus,
      storage: nullStorage,
      persistence,
      permission: { has: () => true, request: async () => true },
      logger: console,
      config: { environment: 'test', version: '0.0.0' },
    }

    authz = new AuthorizationModule({ sessionValidator, actorDirectory })
    await authz.init(context)
  })

  it('constructor exige los dos puertos; init exige persistence', async () => {
    expect(() => new AuthorizationModule({} as never)).toThrow(/sessionValidator/)
    expect(
      () => new AuthorizationModule({ sessionValidator } as never)
    ).toThrow(/actorDirectory/)

    const module = new AuthorizationModule({ sessionValidator, actorDirectory })
    const { persistence: _drop, ...withoutPersistence } = context
    await expect(module.init(withoutPersistence as CoreContext<CoreEventMap>)).rejects.toThrow(/persistence/)
  })

  it('authorize: sesión inválida ⇒ DENY invalid-session (default-deny, sin excepción)', async () => {
    const result = await authz.authorize({ permission: 'photo:create' }, 'token-falsa')

    expect(result).toMatchObject({ decision: 'DENY', reason: 'invalid-session' })
    const decision = emitted.find((e) => e.name === 'authz:decision')
    expect(decision?.payload).toMatchObject({ actorId: 'anonymous', decision: 'DENY' })
  })

  it('authorize: miembro por defecto (sin asignación) puede photo:create y emite authz:decision', async () => {
    const result = await authz.authorize({ permission: 'photo:create' }, VALID_TOKEN)

    expect(result).toMatchObject({ decision: 'ALLOW', matchedRole: 'member' })
    const decision = emitted.find((e) => e.name === 'authz:decision')
    expect(decision?.payload).toMatchObject({
      actorId: USER_ID,
      permission: 'photo:create',
      decision: 'ALLOW',
      reason: 'role:member',
    })
  })

  it('buildContext ensambla el SecurityContext de la Baseline §3', async () => {
    const securityContext = await authz.buildContext(VALID_TOKEN)

    expect(securityContext).toMatchObject({
      actorId: USER_ID,
      roles: ['member'],
      accountStatus: 'ACTIVE',
      accountType: 'PERSONAL',
      verifiedAttributes: ['email'],
      riskLevel: 'UNKNOWN',
      sessionInfo: { sessionId: 'sess-1', deviceFingerprint: 'dev-1' },
    })
  })

  it('cuenta no-ACTIVE ⇒ default guest + DENY del evaluador', async () => {
    accountStatus = 'SUSPENDED'

    const roles = await authz.getRoles(USER_ID)
    expect(roles).toEqual(['guest'])

    const result = await authz.authorize({ permission: 'photo:create' }, VALID_TOKEN)
    expect(result).toMatchObject({ decision: 'DENY', reason: 'account-status:SUSPENDED' })
  })

  it('assignRoles persiste, valida roles conocidos y emite authz:role-assigned', async () => {
    await authz.assignRoles(USER_ID, ['member', 'moderator'])

    const result = await authz.authorize(
      { permission: 'photo:delete', resource: { type: 'photo', id: 'p9', ownerId: 'otro' } },
      VALID_TOKEN
    )
    expect(result).toMatchObject({ decision: 'ALLOW', matchedRole: 'moderator' })

    const event = emitted.find((e) => e.name === 'authz:role-assigned')
    expect(event?.payload).toMatchObject({ userId: USER_ID, roles: ['member', 'moderator'] })

    // Las asignaciones sobreviven reinicialización
    const second = new AuthorizationModule({ sessionValidator, actorDirectory })
    await second.init(context)
    expect(await second.getRoles(USER_ID)).toEqual(['member', 'moderator'])

    await expect(authz.assignRoles(USER_ID, ['rol-inventado'])).rejects.toThrow(UnknownRoleError)
  })

  it('revokeRole elimina el rol y emite authz:role-revoked; errores tipados', async () => {
    await authz.assignRoles(USER_ID, ['member', 'creator'])
    await authz.revokeRole(USER_ID, 'creator')

    expect(await authz.getRoles(USER_ID)).toEqual(['member'])
    expect(emitted.some((e) => e.name === 'authz:role-revoked')).toBe(true)

    await expect(authz.revokeRole(USER_ID, 'creator')).rejects.toThrow(RoleNotAssignedError)
  })

  it('evaluate puro: síncrono, sin puertos ni I/O (usable standalone)', () => {
    const result = authz.evaluate(
      { permission: 'photo:delete', resource: { type: 'photo', id: 'p1', ownerId: USER_ID } },
      {
        actorId: USER_ID,
        roles: ['member'],
        accountStatus: 'ACTIVE',
        accountType: 'PERSONAL',
        verifiedAttributes: [],
        sessionInfo: null,
        riskLevel: 'UNKNOWN',
      }
    )
    expect(result).toMatchObject({ decision: 'ALLOW', reason: 'role:member' })
  })

  it('listRoles expone los built-in', () => {
    expect(authz.listRoles().map((r) => r.name)).toEqual([
      'guest',
      'member',
      'creator',
      'moderator',
      'admin',
    ])
  })
})
