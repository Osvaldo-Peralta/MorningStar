// identity/domain/usernamePolicy.ts
import { InvalidUsernameError } from '../errors.js'

/**
 * Política de usernames (Baseline v1.0 §1: "username (unique, alphanumeric)").
 *
 * - Normalización: trim + lowercase (la unicidad es case-insensitive).
 * - Charset: solo [a-z0-9] tras normalizar (alfanumérico estricto, sin
 *   underscores ni Unicode).
 * - Longitud: 3..32 (no definida en la Baseline; decisión ADR-0005).
 */
export const USERNAME_LIMITS = {
  minLength: 3,
  maxLength: 32,
} as const

const USERNAME_PATTERN = /^[a-z0-9]+$/

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Valida y devuelve el username normalizado; lanza `InvalidUsernameError`. */
export function validateUsername(raw: string): string {
  if (typeof raw !== 'string') {
    throw new InvalidUsernameError('username must be a string')
  }

  const normalized = normalizeUsername(raw)

  if (normalized.length < USERNAME_LIMITS.minLength || normalized.length > USERNAME_LIMITS.maxLength) {
    throw new InvalidUsernameError(
      `username must have ${USERNAME_LIMITS.minLength}-${USERNAME_LIMITS.maxLength} characters (got ${normalized.length})`
    )
  }

  if (!USERNAME_PATTERN.test(normalized)) {
    throw new InvalidUsernameError(
      `username must be alphanumeric (a-z, 0-9): '${raw}' is not valid`
    )
  }

  return normalized
}
