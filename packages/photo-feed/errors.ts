// modules/photo-feed/errors.ts
// Errores del módulo photo-feed. `name` estable (filtrable en logs/audit).

export class PhotoFeedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PhotoFeedError'
  }
}

/**
 * La composición configuró un Authorizer pero la llamada no trae actor
 * (fail-closed estricto, ADR-0012): con autorización activa no existen las
 * operaciones anónimas.
 */
export class PermissionRequiredError extends PhotoFeedError {
  readonly permission: string

  constructor(permission: string) {
    super(
      `Permission check required for '${permission}': pass an ActorContext (authorization is enabled)`
    )
    this.name = 'PermissionRequiredError'
    this.permission = permission
  }
}

/**
 * La decisión de autorización no fue ALLOW. Para CONDITIONAL, `conditions`
 * lista lo que el composition layer debería cumplir (enforcement loop,
 * deuda ADR-0011 §6): photo-feed las trata como denegación.
 */
export class PermissionDeniedError extends PhotoFeedError {
  readonly permission: string
  readonly decision: 'DENY' | 'CONDITIONAL'
  readonly reason: string
  readonly conditions?: readonly string[]

  constructor(
    permission: string,
    decision: 'DENY' | 'CONDITIONAL',
    reason: string,
    conditions?: readonly string[]
  ) {
    super(
      `Permission denied for '${permission}' (${decision}: ${reason}` +
        (conditions?.length ? `, conditions: ${conditions.join(', ')}` : '') +
        ')'
    )
    this.name = 'PermissionDeniedError'
    this.permission = permission
    this.decision = decision
    this.reason = reason
    this.conditions = conditions
  }
}
