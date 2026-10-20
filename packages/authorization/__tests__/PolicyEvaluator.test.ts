// Evaluador puro: tabla de reglas completa (Baseline §3 + ADR-0011)
import { describe, it, expect } from 'vitest'
import { DefaultPolicyEvaluator } from '../domain/PolicyEvaluator.js'
import { permissionMatches } from '../domain/permissions.js'
import { BUILTIN_ROLES, SENSITIVE_PERMISSIONS } from '../domain/roles.js'
import type { AuthorizationRequest, SecurityContext } from '../domain/SecurityContext.js'

const baseContext = (overrides?: Partial<SecurityContext>): SecurityContext => ({
  actorId: 'user-1',
  roles: ['member'],
  accountStatus: 'ACTIVE',
  accountType: 'PERSONAL',
  verifiedAttributes: ['email'],
  sessionInfo: null,
  riskLevel: 'UNKNOWN',
  ...overrides,
})

const evaluator = new DefaultPolicyEvaluator()

describe('permissionMatches', () => {
  it('exact, wildcard total y wildcard de recurso', () => {
    expect(permissionMatches('photo:delete', 'photo:delete')).toBe(true)
    expect(permissionMatches('photo:delete', 'photo:create')).toBe(false)
    expect(permissionMatches('*', 'cualquier:cosa')).toBe(true)
    expect(permissionMatches('photo:*', 'photo:delete')).toBe(true)
    expect(permissionMatches('photo:*', 'media:upload')).toBe(false)
  })
})

describe('DefaultPolicyEvaluator — reglas 1 y 2 (estado y riesgo)', () => {
  const request: AuthorizationRequest = { permission: 'photo:create' }

  it('regla 1: cuenta no-ACTIVE ⇒ DENY (todos los estados)', () => {
    for (const status of ['PENDING_VERIFICATION', 'SUSPENDED', 'DEACTIVATED', 'BANNED']) {
      const result = evaluator.evaluate(request, baseContext({ accountStatus: status }))
      expect(result).toMatchObject({ decision: 'DENY', reason: `account-status:${status}` })
    }
  })

  it('regla 2: riskLevel CRITICAL ⇒ DENY', () => {
    const result = evaluator.evaluate(request, baseContext({ riskLevel: 'CRITICAL' }))
    expect(result).toMatchObject({ decision: 'DENY', reason: 'risk-level:CRITICAL' })
  })

  it('regla 2: riskLevel HIGH ⇒ CONDITIONAL require-step-up (incluso para admin)', () => {
    const result = evaluator.evaluate(request, baseContext({ riskLevel: 'HIGH', roles: ['admin'] }))
    expect(result).toMatchObject({ decision: 'CONDITIONAL', conditions: ['require-step-up'] })
  })

  it("riskLevel 'UNKNOWN'/'LOW'/'MEDIUM' no interfieren", () => {
    for (const riskLevel of ['UNKNOWN', 'LOW', 'MEDIUM'] as const) {
      const result = evaluator.evaluate(request, baseContext({ riskLevel }))
      expect(result.decision).toBe('ALLOW')
    }
  })
})

describe('DefaultPolicyEvaluator — reglas 3-5 (roles, ownership, sensibles)', () => {
  it('member: photo:create ALLOW; photo:view ALLOW', () => {
    expect(evaluator.evaluate({ permission: 'photo:create' }, baseContext())).toMatchObject({
      decision: 'ALLOW',
      matchedRole: 'member',
    })
    expect(evaluator.evaluate({ permission: 'photo:view' }, baseContext())).toMatchObject({
      decision: 'ALLOW',
    })
  })

  it("default-deny: permiso no otorgado ⇒ DENY 'no-role-grants-permission'", () => {
    const result = evaluator.evaluate({ permission: 'community:ban' }, baseContext())
    expect(result).toMatchObject({ decision: 'DENY', reason: 'no-role-grants-permission' })
  })

  it('ownership: member borra su propia foto (ALLOW) pero no la ajena (DENY)', () => {
    const own = { permission: 'photo:delete', resource: { type: 'photo', id: 'p1', ownerId: 'user-1' } }
    const foreign = { permission: 'photo:delete', resource: { type: 'photo', id: 'p2', ownerId: 'user-2' } }

    expect(evaluator.evaluate(own, baseContext())).toMatchObject({ decision: 'ALLOW', matchedRole: 'member' })
    expect(evaluator.evaluate(foreign, baseContext())).toMatchObject({ decision: 'DENY' })
  })

  it('ownership sin ownerId en el recurso ⇒ DENY (no se puede probar propiedad)', () => {
    const result = evaluator.evaluate(
      { permission: 'photo:delete', resource: { type: 'photo', id: 'p1' } },
      baseContext()
    )
    expect(result.decision).toBe('DENY')
  })

  it('moderator: photo:delete ajeno ALLOW (grant directo, sin -own)', () => {
    const foreign = { permission: 'photo:delete', resource: { type: 'photo', id: 'p2', ownerId: 'user-2' } }
    const result = evaluator.evaluate(foreign, baseContext({ roles: ['member', 'moderator'] }))
    expect(result).toMatchObject({ decision: 'ALLOW', matchedRole: 'moderator' })
  })

  it('admin: wildcard total, pero sensibles quedan CONDITIONAL require-mfa', () => {
    const normal = evaluator.evaluate({ permission: 'photo:delete' }, baseContext({ roles: ['admin'] }))
    expect(normal).toMatchObject({ decision: 'ALLOW', matchedRole: 'admin' })

    const sensitive = evaluator.evaluate({ permission: 'account:delete' }, baseContext({ roles: ['admin'] }))
    expect(sensitive).toMatchObject({
      decision: 'CONDITIONAL',
      reason: 'sensitive-permission',
      matchedRole: 'admin',
      conditions: ['require-mfa'],
    })
  })

  it('moderator + user:suspend (sensible) ⇒ CONDITIONAL require-mfa', () => {
    const result = evaluator.evaluate({ permission: 'user:suspend' }, baseContext({ roles: ['moderator'] }))
    expect(result).toMatchObject({ decision: 'CONDITIONAL', conditions: ['require-mfa'] })
  })

  it('rol desconocido en el contexto se ignora (no otorga, no lanza)', () => {
    const result = evaluator.evaluate(
      { permission: 'photo:create' },
      baseContext({ roles: ['rol-inventado', 'member'] })
    )
    expect(result).toMatchObject({ decision: 'ALLOW', matchedRole: 'member' })
  })

  it('guest: sin permisos ⇒ todo DENY', () => {
    expect(evaluator.evaluate({ permission: 'photo:list' }, baseContext({ roles: ['guest'] }))).toMatchObject({
      decision: 'DENY',
    })
  })
})

describe('DefaultPolicyEvaluator — permisos de messaging (Fase 6, 9a)', () => {
  it('member: msg:send y msg:read ALLOW', () => {
    expect(evaluator.evaluate({ permission: 'msg:send' }, baseContext())).toMatchObject({
      decision: 'ALLOW',
      matchedRole: 'member',
    })
    expect(evaluator.evaluate({ permission: 'msg:read' }, baseContext())).toMatchObject({
      decision: 'ALLOW',
    })
  })

  it('ownership: member edita/borra su mensaje (ALLOW) pero no el ajeno (DENY)', () => {
    const own = { permission: 'msg:edit', resource: { type: 'message', id: 'm1', ownerId: 'user-1' } }
    const foreign = { permission: 'msg:edit', resource: { type: 'message', id: 'm2', ownerId: 'user-2' } }
    expect(evaluator.evaluate(own, baseContext())).toMatchObject({ decision: 'ALLOW', matchedRole: 'member' })
    expect(evaluator.evaluate(foreign, baseContext())).toMatchObject({ decision: 'DENY' })

    const ownDelete = { permission: 'msg:delete', resource: { type: 'message', id: 'm1', ownerId: 'user-1' } }
    const foreignDelete = { permission: 'msg:delete', resource: { type: 'message', id: 'm2', ownerId: 'user-2' } }
    expect(evaluator.evaluate(ownDelete, baseContext())).toMatchObject({ decision: 'ALLOW' })
    expect(evaluator.evaluate(foreignDelete, baseContext())).toMatchObject({ decision: 'DENY' })
  })

  it('moderator: msg:delete ajeno ALLOW (moderación plena); msg:edit ajeno sigue DENY', () => {
    const foreign = { permission: 'msg:delete', resource: { type: 'message', id: 'm2', ownerId: 'user-2' } }
    expect(
      evaluator.evaluate(foreign, baseContext({ roles: ['member', 'moderator'] }))
    ).toMatchObject({ decision: 'ALLOW', matchedRole: 'moderator' })

    const foreignEdit = { permission: 'msg:edit', resource: { type: 'message', id: 'm2', ownerId: 'user-2' } }
    expect(
      evaluator.evaluate(foreignEdit, baseContext({ roles: ['member', 'moderator'] }))
    ).toMatchObject({ decision: 'DENY' })
  })

  it('guest: msg:* todo DENY', () => {
    for (const permission of ['msg:send', 'msg:read', 'msg:edit', 'msg:delete']) {
      expect(
        evaluator.evaluate({ permission }, baseContext({ roles: ['guest'] }))
      ).toMatchObject({ decision: 'DENY' })
    }
  })
})

describe('DefaultPolicyEvaluator — configuración', () => {
  it('extraRoles amplían el registro; colisión con built-in lanza', () => {
    const custom = new DefaultPolicyEvaluator({
      extraRoles: [{ name: 'support', permissions: ['ticket:read', 'user:view'] }],
    })
    expect(custom.evaluate({ permission: 'ticket:read' }, baseContext({ roles: ['support'] }))).toMatchObject({
      decision: 'ALLOW',
      matchedRole: 'support',
    })
    expect(custom.listRoles().map((r) => r.name)).toContain('support')

    expect(() => new DefaultPolicyEvaluator({ extraRoles: [{ name: 'admin', permissions: [] }] })).toThrow(
      /colisiona/
    )
  })

  it('sensitivePermissions propio reemplaza al default', () => {
    const custom = new DefaultPolicyEvaluator({ sensitivePermissions: ['photo:create'] })
    expect(custom.evaluate({ permission: 'photo:create' }, baseContext())).toMatchObject({
      decision: 'CONDITIONAL',
      conditions: ['require-mfa'],
    })
    // account:* ya no es sensible con la lista propia, pero member no lo otorga ⇒ DENY
    expect(custom.evaluate({ permission: 'account:delete' }, baseContext({ roles: ['admin'] }))).toMatchObject({
      decision: 'ALLOW',
    })
  })

  it('wildcard -own: creator con media:*-own sobre recurso propio', () => {
    const own = { permission: 'media:transcode', resource: { type: 'media', id: 'm1', ownerId: 'user-1' } }
    const foreign = { permission: 'media:transcode', resource: { type: 'media', id: 'm2', ownerId: 'user-2' } }
    const custom = new DefaultPolicyEvaluator({
      extraRoles: [{ name: 'media-owner', permissions: ['media:*-own'] }],
    })
    expect(custom.evaluate(own, baseContext({ roles: ['media-owner'] }))).toMatchObject({ decision: 'ALLOW' })
    expect(custom.evaluate(foreign, baseContext({ roles: ['media-owner'] }))).toMatchObject({ decision: 'DENY' })
  })

  it('los built-in y sensibles exportados son consistentes', () => {
    expect(BUILTIN_ROLES.map((r) => r.name)).toEqual(['guest', 'member', 'creator', 'moderator', 'admin'])
    expect(SENSITIVE_PERMISSIONS).toContain('account:*')
  })
})
