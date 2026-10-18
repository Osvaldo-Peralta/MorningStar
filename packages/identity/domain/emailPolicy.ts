// identity/domain/emailPolicy.ts
import { InvalidEmailError } from '../errors.js'

/**
 * Política de email (ADR-0006):
 * - Normalización: trim + lowercase (unicidad case-insensitive).
 * - Validación pragmática (no RFC 5322 completo): `algo@algo.tld`.
 * - Longitud máxima 254 (RFC 5321).
 */
export const EMAIL_LIMITS = {
  maxLength: 254,
} as const

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}

/** Valida y devuelve el email normalizado; lanza `InvalidEmailError`. */
export function validateEmail(raw: string): string {
  if (typeof raw !== 'string') {
    throw new InvalidEmailError('email must be a string')
  }

  const normalized = normalizeEmail(raw)

  if (normalized.length > EMAIL_LIMITS.maxLength) {
    throw new InvalidEmailError(`email too long (max ${EMAIL_LIMITS.maxLength} characters)`)
  }
  if (!EMAIL_PATTERN.test(normalized)) {
    throw new InvalidEmailError(`'${raw}' is not a valid email address`)
  }

  return normalized
}
