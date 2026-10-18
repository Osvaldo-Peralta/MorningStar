// identity/domain/displayNamePolicy.ts
import { InvalidDisplayNameError } from '../errors.js'

/**
 * displayName: Unicode completo (Baseline v1.0 §1). Se mide en code points
 * (no UTF-16 units) para tratar correctamente emojis y caracteres astrales.
 * Límite 1..100 (decisión ADR-0005).
 */
export const DISPLAY_NAME_LIMITS = {
  minLength: 1,
  maxLength: 100,
} as const

/** Valida y devuelve el displayName normalizado (trim); lanza `InvalidDisplayNameError`. */
export function validateDisplayName(raw: string): string {
  if (typeof raw !== 'string') {
    throw new InvalidDisplayNameError('displayName must be a string')
  }

  const trimmed = raw.trim()
  const codePoints = [...trimmed].length

  if (codePoints < DISPLAY_NAME_LIMITS.minLength) {
    throw new InvalidDisplayNameError('displayName must not be empty')
  }
  if (codePoints > DISPLAY_NAME_LIMITS.maxLength) {
    throw new InvalidDisplayNameError(
      `displayName must have at most ${DISPLAY_NAME_LIMITS.maxLength} characters (got ${codePoints})`
    )
  }

  return trimmed
}
