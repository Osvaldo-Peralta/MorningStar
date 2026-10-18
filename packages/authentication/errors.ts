// authentication/errors.ts
// Jerarquía de errores del módulo Authentication.
// `name` estable en todos (filtrable en logs/audit).

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthenticationError'
  }
}

/** Contraseña viola la política (longitud, etc.). */
export class InvalidPasswordError extends AuthenticationError {
  constructor(reason: string) {
    super(`Invalid password: ${reason}`)
    this.name = 'InvalidPasswordError'
  }
}

/**
 * Error GENÉRICO de credenciales: se usa tanto para usuario inexistente como
 * para contraseña incorrecta (anti-enumeración, ADR-0007). Nunca revelar cuál
 * de los dos casos ocurrió.
 */
export class InvalidCredentialsError extends AuthenticationError {
  constructor() {
    super('Invalid credentials')
    this.name = 'InvalidCredentialsError'
  }
}

/** El usuario no tiene contraseña configurada (tratado como credencial inválida en login). */
export class MissingCredentialsError extends AuthenticationError {
  readonly userId: string

  constructor(userId: string) {
    super(`No credentials set for user '${userId}'`)
    this.name = 'MissingCredentialsError'
    this.userId = userId
  }
}

/** Cuenta bloqueada por intentos fallidos consecutivos (lockout). */
export class AccountLockedError extends AuthenticationError {
  readonly retryAfterMs: number

  constructor(retryAfterMs: number) {
    super(`Account temporarily locked. Retry in ${Math.ceil(retryAfterMs / 1000)}s`)
    this.name = 'AccountLockedError'
    this.retryAfterMs = retryAfterMs
  }
}

/**
 * La contraseña es correcta pero el estado de la cuenta no permite login
 * (solo se lanza DESPUÉS de validar credenciales: la información de estado
 * solo la ve el dueño legítimo — ADR-0007).
 */
export class AccountNotActiveError extends AuthenticationError {
  readonly accountStatus: string

  constructor(accountStatus: string) {
    super(`Account is not active (status: ${accountStatus})`)
    this.name = 'AccountNotActiveError'
    this.accountStatus = accountStatus
  }
}
