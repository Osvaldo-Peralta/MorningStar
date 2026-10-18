// authentication/domain/PasswordResetTokenRecord.ts
import type { PersistedRecord } from '@morningstar/core'

/**
 * Token de reset de contraseña self-service (ADR-0009).
 * Namespace: `auth:password-reset-tokens`.
 *
 * Mismo ciclo de vida que los tokens de verificación de email (ADR-0006):
 * generated per request, single-use, expires, invalidates previous active
 * tokens. `id` = SHA-256(token); el claro solo viaja en el email.
 */
export interface PasswordResetTokenRecord extends PersistedRecord {
  readonly userId: string
  readonly createdAt: number
  readonly expiresAt: number
  readonly consumedAt?: number
  readonly invalidatedAt?: number
}
