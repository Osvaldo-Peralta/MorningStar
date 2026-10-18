// authorization/domain/SecurityContext.ts

/**
 * SecurityContext (Baseline v1.0 §3) — los campos exactos de la referencia
 * congelada. Lo ensambla el AuthorizationModule (con I/O vía puertos) y lo
 * consume el evaluador de políticas (SIN I/O — regla de oro de la Baseline:
 * "No DB access inside evaluation").
 *
 * `accountStatus`, `accountType` y `riskLevel` usan los wire-values de sus
 * módulos dueños (duplicación deliberada del formato para mantener el
 * desacoplamiento feature ↔ feature — ADR-0007/0011).
 */

export type AuthorizationRiskLevel = 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface SessionInfoRef {
  readonly sessionId: string
  readonly deviceFingerprint: string
  readonly issuedAt: number
  readonly expiresAt: number
}

export interface SecurityContext {
  readonly actorId: string
  readonly roles: readonly string[]
  readonly accountStatus: string
  readonly accountType: string
  /** Atributos verificados: 'email' hoy; 'phone', 'gov-id', etc. en el futuro. */
  readonly verifiedAttributes: readonly string[]
  readonly sessionInfo: SessionInfoRef | null
  readonly riskLevel: AuthorizationRiskLevel
}

/** Petición de autorización: permiso concreto + recurso opcional. */
export interface AuthorizationRequest {
  readonly permission: string
  readonly resource?: {
    readonly type: string
    readonly id?: string
    readonly ownerId?: string
  }
}

export type AuthorizationDecision = 'ALLOW' | 'DENY' | 'CONDITIONAL'

/**
 * Condiciones estándar de un CONDITIONAL (MVP):
 * - 'require-step-up': riesgo HIGH — re-autenticación elevada (Fase 8).
 * - 'require-mfa': permiso sensible — prueba de segundo factor.
 * - 'require-ownership': falta ownerId en el recurso para evaluar '-own'.
 */
export type AuthorizationCondition = 'require-step-up' | 'require-mfa' | 'require-ownership'

export interface AuthorizationResult {
  readonly decision: AuthorizationDecision
  /** Razón estable y legible por máquina (ej. 'role:moderator', 'account-status:SUSPENDED'). */
  readonly reason: string
  readonly matchedRole?: string
  readonly conditions?: readonly AuthorizationCondition[]
}
