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

/** Refresh token desconocido, revocado, expirado o de sesión revocada (genérico a propósito). */
export class InvalidRefreshTokenError extends AuthenticationError {
  constructor() {
    super('Invalid refresh token')
    this.name = 'InvalidRefreshTokenError'
  }
}

/**
 * Refresh token ya consumido presentado de nuevo: señal clásica de robo
 * (ADR-0009). Dispara la revocación de la sesión asociada y el evento
 * `auth:refresh-reuse-detected`.
 */
export class RefreshTokenReuseError extends AuthenticationError {
  constructor() {
    super('Refresh token reuse detected; associated session revoked')
    this.name = 'RefreshTokenReuseError'
  }
}

/** Token de reset desconocido o invalidado por una solicitud más reciente. */
export class InvalidResetTokenError extends AuthenticationError {
  constructor() {
    super('Invalid password reset token')
    this.name = 'InvalidResetTokenError'
  }
}

/** Token de reset reemplazado por una solicitud más reciente. */
export class ResetTokenInvalidatedError extends AuthenticationError {
  constructor() {
    super('Password reset token was invalidated by a newer request')
    this.name = 'ResetTokenInvalidatedError'
  }
}

/** Token de reset ya consumido (single-use). */
export class ResetTokenAlreadyUsedError extends AuthenticationError {
  constructor() {
    super('Password reset token was already used (single-use)')
    this.name = 'ResetTokenAlreadyUsedError'
  }
}

/** Token de reset expirado. */
export class ResetTokenExpiredError extends AuthenticationError {
  constructor() {
    super('Password reset token has expired')
    this.name = 'ResetTokenExpiredError'
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
