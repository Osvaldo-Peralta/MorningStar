// authentication/domain/PasswordPolicy.ts
import { InvalidPasswordError } from '../errors.js'

/**
 * Política de contraseñas MVP (ADR-0007): longitud mínima 8 (estándar NIST
 * 800-63B) y máxima 128 (cota anti-DoS del hashing). Reglas de complejidad/
 * listas de contraseñas filtradas quedan como deuda (llegarán con el backend
 * o librerías específicas). Configurable por instancia del módulo.
 */
export const PASSWORD_POLICY = {
  minLength: 8,
  maxLength: 128,
} as const

export interface PasswordPolicyOverrides {
  readonly minLength?: number
  readonly maxLength?: number
}

export function validatePassword(
  password: string,
  overrides: PasswordPolicyOverrides = {}
): void {
  const minLength = overrides.minLength ?? PASSWORD_POLICY.minLength
  const maxLength = overrides.maxLength ?? PASSWORD_POLICY.maxLength

  if (typeof password !== 'string') {
    throw new InvalidPasswordError('password must be a string')
  }
  if (password.length < minLength) {
    throw new InvalidPasswordError(`password must have at least ${minLength} characters`)
  }
  if (password.length > maxLength) {
    throw new InvalidPasswordError(`password must have at most ${maxLength} characters`)
  }
}
