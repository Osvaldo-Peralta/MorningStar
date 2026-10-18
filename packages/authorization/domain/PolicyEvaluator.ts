// authorization/domain/PolicyEvaluator.ts
import type {
  AuthorizationCondition,
  AuthorizationRequest,
  AuthorizationResult,
  SecurityContext,
} from './SecurityContext.js'
import { isOwnVariant, isOwnWildcard, permissionMatches } from './permissions.js'
import {
  BUILTIN_ROLES,
  SENSITIVE_PERMISSIONS,
  type RoleDefinition,
} from './roles.js'

export interface PolicyEvaluatorOptions {
  /** Roles adicionales a los built-in (misma forma; no pueden pisar nombres built-in). */
  readonly extraRoles?: readonly RoleDefinition[]
  /** Lista propia de permisos sensibles (default: SENSITIVE_PERMISSIONS). */
  readonly sensitivePermissions?: readonly string[]
}

/**
 * Evaluador de políticas por defecto (Baseline v1.0 §3).
 *
 * PURO Y SÍNCRONO: cero I/O, cero dependencias del estado externo — la
 * regla de oro "No DB access inside evaluation" se cumple por construcción.
 *
 * Orden de reglas (ADR-0011):
 * 1. accountStatus !== 'ACTIVE'            ⇒ DENY
 * 2. riskLevel === 'CRITICAL'              ⇒ DENY
 *    riskLevel === 'HIGH'                  ⇒ CONDITIONAL ['require-step-up']
 * 3. Ningún rol del actor otorga el permiso ⇒ DENY (default-deny)
 * 4. Permiso sensible otorgado             ⇒ CONDITIONAL ['require-mfa']
 * 5. Otorgado                              ⇒ ALLOW
 *
 * Las reglas 1-2 con riskLevel 'UNKNOWN' (estado actual hasta Fase 8) no
 * disparan nada: el cableado con el Risk Engine ya está listo.
 */
export class DefaultPolicyEvaluator {
  private readonly roles: ReadonlyMap<string, RoleDefinition>
  private readonly sensitivePermissions: readonly string[]

  constructor(options: PolicyEvaluatorOptions = {}) {
    const merged = new Map<string, RoleDefinition>()
    for (const role of BUILTIN_ROLES) merged.set(role.name, role)
    for (const role of options.extraRoles ?? []) {
      if (merged.has(role.name)) {
        throw new Error(`Role '${role.name}' colisiona con un rol built-in`)
      }
      merged.set(role.name, role)
    }
    this.roles = merged
    this.sensitivePermissions = options.sensitivePermissions ?? SENSITIVE_PERMISSIONS
  }

  evaluate(request: AuthorizationRequest, context: SecurityContext): AuthorizationResult {
    // Regla 1 — estado de cuenta
    if (context.accountStatus !== 'ACTIVE') {
      return { decision: 'DENY', reason: `account-status:${context.accountStatus}` }
    }

    // Regla 2 — riesgo (dormiente hasta Fase 8: riskLevel suele ser 'UNKNOWN')
    if (context.riskLevel === 'CRITICAL') {
      return { decision: 'DENY', reason: 'risk-level:CRITICAL' }
    }
    if (context.riskLevel === 'HIGH') {
      return {
        decision: 'CONDITIONAL',
        reason: 'risk-level:HIGH',
        conditions: ['require-step-up'],
      }
    }

    // Regla 3 — matching de roles (default-deny)
    const matchedRole = this.findGrantingRole(request, context)
    if (!matchedRole) {
      return { decision: 'DENY', reason: 'no-role-grants-permission' }
    }

    // Regla 4 — permisos sensibles exigen segundo factor
    if (this.isSensitive(request.permission)) {
      return {
        decision: 'CONDITIONAL',
        reason: 'sensitive-permission',
        matchedRole,
        conditions: ['require-mfa'],
      }
    }

    // Regla 5 — permitido
    return { decision: 'ALLOW', reason: `role:${matchedRole}`, matchedRole }
  }

  /** Roles conocidos por el evaluador (built-in + extras). */
  listRoles(): RoleDefinition[] {
    return Array.from(this.roles.values())
  }

  private findGrantingRole(
    request: AuthorizationRequest,
    context: SecurityContext
  ): string | undefined {
    for (const roleName of context.roles) {
      const role = this.roles.get(roleName)
      if (!role) continue // rol desconocido: se ignora (no otorga nada)
      if (role.permissions.some((granted) => this.satisfies(granted, request, context))) {
        return roleName
      }
    }
    return undefined
  }

  private satisfies(
    granted: string,
    request: AuthorizationRequest,
    context: SecurityContext
  ): boolean {
    // Variantes de propiedad: 'photo:delete-own', 'media:*-own'
    if (granted.endsWith('-own')) {
      const ownerId = request.resource?.ownerId
      if (ownerId === undefined) return false // sin dueño conocido no hay grant
      if (ownerId !== context.actorId) return false
      if (isOwnWildcard(granted)) {
        const wildcard = granted.slice(0, -4) // 'media:*-own' → 'media:*'
        return permissionMatches(wildcard, request.permission)
      }
      return isOwnVariant(granted, request.permission)
    }
    return permissionMatches(granted, request.permission)
  }

  private isSensitive(permission: string): boolean {
    return this.sensitivePermissions.some((sensitive) =>
      permissionMatches(sensitive, permission)
    )
  }
}

/** Utilidad pública: ¿la condición dada pertenece al conjunto estándar? */
export function isStandardCondition(value: string): value is AuthorizationCondition {
  return value === 'require-step-up' || value === 'require-mfa' || value === 'require-ownership'
}
