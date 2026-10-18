// authorization/errors.ts
// `name` estable en todos (filtrable en logs/audit).

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthorizationError'
  }
}

/** Rol no registrado (ni built-in ni extra) al asignar/revocar. */
export class UnknownRoleError extends AuthorizationError {
  readonly role: string

  constructor(role: string) {
    super(`Unknown role '${role}'`)
    this.name = 'UnknownRoleError'
    this.role = role
  }
}

/** Revocación de un rol que el usuario no tiene asignado. */
export class RoleNotAssignedError extends AuthorizationError {
  readonly userId: string
  readonly role: string

  constructor(userId: string, role: string) {
    super(`Role '${role}' is not assigned to user '${userId}'`)
    this.name = 'RoleNotAssignedError'
    this.userId = userId
    this.role = role
  }
}
