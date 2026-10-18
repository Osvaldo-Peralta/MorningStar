// authorization/AuthorizationModule.ts
import { ModuleState } from '@morningstar/core'
import type { AppModule, CoreContext, Repository } from '@morningstar/core'
import type { RoleAssignmentRecord } from './domain/RoleAssignmentRecord.js'
import {
  DEFAULT_ROLE,
  INACTIVE_ROLE,
  type RoleDefinition,
} from './domain/roles.js'
import type {
  AuthorizationRequest,
  AuthorizationResult,
  AuthorizationRiskLevel,
  SecurityContext,
  SessionInfoRef,
} from './domain/SecurityContext.js'
import { DefaultPolicyEvaluator, type PolicyEvaluatorOptions } from './domain/PolicyEvaluator.js'
import { RoleNotAssignedError, UnknownRoleError } from './errors.js'
import { AUTHZ_EVENTS } from './events.js'

/** Namespace del repositorio de asignaciones (ADR-0002/0003). */
const ROLE_ASSIGNMENTS_NAMESPACE = 'authorization:role-assignments'

/**
 * Puerto de validación de sesiones (ADR-0011). La composición lo cablea con
 * `AuthenticationModule.validateSession` — authorization NO importa
 * authentication (feature ↔ feature prohibido).
 */
export interface SessionValidatorPort {
  validateSession(token: string): Promise<{
    readonly userId: string
    readonly sessionId: string
    readonly deviceFingerprint: string
    readonly issuedAt: number
    readonly expiresAt: number
    readonly riskLevel?: AuthorizationRiskLevel
  } | null>
}

/**
 * Puerto de directorio del actor. La composición lo cablea con
 * `IdentityModule.getUser` (+ mapeo de verificationFlags → verifiedAttributes).
 */
export interface ActorAccount {
  readonly accountStatus: string
  readonly accountType: string
  readonly verifiedAttributes: readonly string[]
}

export interface ActorDirectoryPort {
  getActor(userId: string): Promise<ActorAccount | null>
}

export interface AuthorizationModuleOptions extends PolicyEvaluatorOptions {
  readonly sessionValidator: SessionValidatorPort
  readonly actorDirectory: ActorDirectoryPort
}

/**
 * Módulo de autorización (Fase 5, Baseline v1.0 §3).
 *
 * Dos niveles de API:
 * - `evaluate(request, context)`: SÍNCRONO y PURO — la decisión formal
 *   ALLOW/DENY/CONDITIONAL sin ningún I/O ("No DB access inside evaluation").
 * - `authorize(request, sessionToken)`: asíncrono — ensambla el
 *   SecurityContext vía puertos (sesión + actor + roles), evalúa y emite
 *   `authz:decision` (fuente del futuro Audit Trail, Fase 8).
 *
 * Requiere `context.persistence` (asignaciones de roles).
 */
export class AuthorizationModule implements AppModule {
  readonly id = 'authorization'
  readonly version = '0.1.0'

  private readonly sessionValidator: SessionValidatorPort
  private readonly actorDirectory: ActorDirectoryPort
  private readonly evaluator: DefaultPolicyEvaluator

  private roleAssignments?: Repository<RoleAssignmentRecord>
  private events?: CoreContext['events']

  state = ModuleState.Registered

  constructor(options: AuthorizationModuleOptions) {
    if (!options.sessionValidator) {
      throw new Error("AuthorizationModule requiere 'sessionValidator' (SessionValidatorPort)")
    }
    if (!options.actorDirectory) {
      throw new Error("AuthorizationModule requiere 'actorDirectory' (ActorDirectoryPort)")
    }
    this.sessionValidator = options.sessionValidator
    this.actorDirectory = options.actorDirectory
    this.evaluator = new DefaultPolicyEvaluator(options)
  }

  async init(context: CoreContext): Promise<void> {
    if (!context.persistence) {
      throw new Error(
        "AuthorizationModule requiere 'context.persistence' (PersistenceProvider). Ver docs/contracts/authorization.md"
      )
    }
    this.roleAssignments = context.persistence.repository<RoleAssignmentRecord>(
      ROLE_ASSIGNMENTS_NAMESPACE
    )
    this.events = context.events
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async dispose(): Promise<void> {
    this.roleAssignments = undefined
    this.events = undefined
  }

  /** API pública del módulo */

  /** Evaluación pura y síncrona (Baseline §3: sin acceso a DB). */
  evaluate(request: AuthorizationRequest, context: SecurityContext): AuthorizationResult {
    return this.evaluator.evaluate(request, context)
  }

  /**
   * Flujo completo: valida sesión → ensambla SecurityContext → evalúa →
   * emite `authz:decision`. Sesión invadida/expirada ⇒ DENY 'invalid-session'
   * (default-deny, nunca excepción).
   */
  async authorize(request: AuthorizationRequest, sessionToken: string): Promise<AuthorizationResult> {
    if (!this.roleAssignments || !this.events) throw new Error('Not Initialized')

    const context = await this.buildContext(sessionToken)
    const result: AuthorizationResult = context
      ? this.evaluator.evaluate(request, context)
      : { decision: 'DENY', reason: 'invalid-session' }

    this.events.emit({
      name: AUTHZ_EVENTS.DECISION,
      category: 'domain',
      source: { moduleId: this.id, entity: 'authorization', entityId: context?.actorId },
      payload: {
        actorId: context?.actorId ?? 'anonymous',
        permission: request.permission,
        decision: result.decision,
        reason: result.reason,
      },
      timestamp: Date.now(),
    })

    return result
  }

  /** Ensambla el SecurityContext (I/O permitido aquí; nunca en evaluate). */
  async buildContext(sessionToken: string): Promise<SecurityContext | null> {
    if (!this.roleAssignments) throw new Error('Not Initialized')

    const session = await this.sessionValidator.validateSession(sessionToken)
    if (!session) return null

    const actor = await this.actorDirectory.getActor(session.userId)
    if (!actor) return null

    const sessionInfo: SessionInfoRef = {
      sessionId: session.sessionId,
      deviceFingerprint: session.deviceFingerprint,
      issuedAt: session.issuedAt,
      expiresAt: session.expiresAt,
    }

    return {
      actorId: session.userId,
      roles: await this.resolveRoles(session.userId, actor.accountStatus),
      accountStatus: actor.accountStatus,
      accountType: actor.accountType,
      verifiedAttributes: actor.verifiedAttributes,
      sessionInfo,
      riskLevel: session.riskLevel ?? 'UNKNOWN',
    }
  }

  /** Roles asignados; sin asignación ⇒ default por estado de cuenta. */
  async getRoles(userId: string, accountStatus?: string): Promise<readonly string[]> {
    if (!this.roleAssignments) throw new Error('Not Initialized')
    return this.resolveRoles(userId, accountStatus)
  }

  /** Comando de administración: reemplaza la asignación completa del usuario. */
  async assignRoles(userId: string, roles: readonly string[]): Promise<void> {
    if (!this.roleAssignments || !this.events) throw new Error('Not Initialized')

    const known = new Set(this.evaluator.listRoles().map((role) => role.name))
    for (const role of roles) {
      if (!known.has(role)) throw new UnknownRoleError(role)
    }

    await this.roleAssignments.save({
      id: userId,
      roles: [...roles],
      updatedAt: Date.now(),
    })

    this.events.emit({
      name: AUTHZ_EVENTS.ROLE_ASSIGNED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'role-assignment', entityId: userId },
      payload: { userId, roles: [...roles] },
      timestamp: Date.now(),
    })
  }

  /** Comando de administración: revoca un rol de la asignación del usuario. */
  async revokeRole(userId: string, role: string): Promise<void> {
    if (!this.roleAssignments || !this.events) throw new Error('Not Initialized')

    const record = await this.roleAssignments.get(userId)
    if (!record || !record.roles.includes(role)) {
      throw new RoleNotAssignedError(userId, role)
    }

    await this.roleAssignments.save({
      ...record,
      roles: record.roles.filter((assigned) => assigned !== role),
      updatedAt: Date.now(),
    })

    this.events.emit({
      name: AUTHZ_EVENTS.ROLE_REVOKED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'role-assignment', entityId: userId },
      payload: { userId, role },
      timestamp: Date.now(),
    })
  }

  /** Roles definidos (built-in + extras de la composición). */
  listRoles(): RoleDefinition[] {
    return this.evaluator.listRoles()
  }

  private async resolveRoles(userId: string, accountStatus?: string): Promise<readonly string[]> {
    const record = await this.roleAssignments!.get(userId)
    if (record) return record.roles

    // Sin asignación explícita: default por estado (ADR-0011)
    const status = accountStatus ?? (await this.actorDirectory.getActor(userId))?.accountStatus
    return status === 'ACTIVE' ? [DEFAULT_ROLE] : [INACTIVE_ROLE]
  }
}
