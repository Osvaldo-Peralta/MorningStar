// identity/errors.ts
// Jerarquía de errores de dominio del módulo Identity.
// `name` estable en todos (filtrable en logs/audit).

export class IdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IdentityError'
  }
}

export class InvalidUsernameError extends IdentityError {
  constructor(reason: string) {
    super(`Invalid username: ${reason}`)
    this.name = 'InvalidUsernameError'
  }
}

export class InvalidDisplayNameError extends IdentityError {
  constructor(reason: string) {
    super(`Invalid displayName: ${reason}`)
    this.name = 'InvalidDisplayNameError'
  }
}

export class InvalidEmailError extends IdentityError {
  constructor(reason: string) {
    super(`Invalid email: ${reason}`)
    this.name = 'InvalidEmailError'
  }
}

export class UsernameAlreadyTakenError extends IdentityError {
  readonly username: string

  constructor(username: string) {
    super(`Username '${username}' is already taken`)
    this.name = 'UsernameAlreadyTakenError'
    this.username = username
  }
}

export class EmailAlreadyRegisteredError extends IdentityError {
  readonly email: string

  constructor(email: string) {
    super(`Email '${email}' is already registered`)
    this.name = 'EmailAlreadyRegisteredError'
    this.email = email
  }
}

export class UserNotFoundError extends IdentityError {
  readonly userId: string

  constructor(userId: string) {
    super(`User '${userId}' not found`)
    this.name = 'UserNotFoundError'
    this.userId = userId
  }
}

export class InvalidStatusTransitionError extends IdentityError {
  readonly from: string
  readonly to: string

  constructor(from: string, to: string) {
    super(`Invalid account status transition: ${from} -> ${to}`)
    this.name = 'InvalidStatusTransitionError'
    this.from = from
    this.to = to
  }
}

export class InvalidAccountTypeConversionError extends IdentityError {
  readonly from: string
  readonly to: string

  constructor(from: string, to: string) {
    super(`Invalid account type conversion: ${from} -> ${to}`)
    this.name = 'InvalidAccountTypeConversionError'
    this.from = from
    this.to = to
  }
}

/** Base de los errores del flujo de verificación de email (ADR-0006). */
export class EmailVerificationError extends IdentityError {
  constructor(message: string) {
    super(message)
    this.name = 'EmailVerificationError'
  }
}

export class InvalidVerificationTokenError extends EmailVerificationError {
  constructor() {
    super('Verification token is invalid')
    this.name = 'InvalidVerificationTokenError'
  }
}

export class TokenAlreadyUsedError extends EmailVerificationError {
  constructor() {
    super('Verification token was already used (single-use)')
    this.name = 'TokenAlreadyUsedError'
  }
}

export class TokenInvalidatedError extends EmailVerificationError {
  constructor() {
    super('Verification token was invalidated by a newer request')
    this.name = 'TokenInvalidatedError'
  }
}

export class TokenExpiredError extends EmailVerificationError {
  constructor() {
    super('Verification token has expired')
    this.name = 'TokenExpiredError'
  }
}
