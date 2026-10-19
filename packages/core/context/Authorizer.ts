// core/context/Authorizer.ts

/**
 * Puerto de autorización de negocio (ADR-0012).
 *
 * Permite que cualquier módulo consulte decisiones de política SIN importar
 * el módulo de authorization (feature ↔ feature prohibido, ADR-0002): el
 * core define la forma del contrato y `AuthorizationModule` la satisface
 * estructuralmente. La composición lo inyecta en `CoreContext.authorizer`.
 *
 * Los tipos son los wire-types mínimos: el módulo de autorización puede
 * devolver estructuras más ricas (matchedRole, conditions tipadas) porque
 * son asignables estructuralmente a estas.
 */

export interface AuthorizationRequestSpec {
  readonly permission: string
  readonly resource?: {
    readonly type: string
    readonly id?: string
    readonly ownerId?: string
  }
}

export interface AuthorizationDecisionSpec {
  readonly decision: 'ALLOW' | 'DENY' | 'CONDITIONAL'
  readonly reason: string
  readonly conditions?: readonly string[]
}

export interface Authorizer {
  /**
   * Evalúa la petición para la sesión dada. `sessionToken` es la credencial
   * opaca emitida por authentication; el autorizador ensambla el contexto de
   * seguridad y decide (Baseline v1.0 §3).
   */
  authorize(
    request: AuthorizationRequestSpec,
    sessionToken: string
  ): Promise<AuthorizationDecisionSpec>
}
