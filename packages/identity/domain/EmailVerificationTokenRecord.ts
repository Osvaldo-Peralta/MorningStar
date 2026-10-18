// identity/domain/EmailVerificationTokenRecord.ts
import type { PersistedRecord } from '@morningstar/core'

/**
 * Token de verificación de email (Baseline v1.0 §1).
 * Namespace del repositorio: `identity:email-tokens`.
 *
 * Seguridad (ADR-0006):
 * - `id` = SHA-256(token en claro) en hex ⇒ lookup O(1) sin revelar el token.
 * - El token en claro NUNCA se persiste (solo viaja en el email).
 * - Single-use: `consumedAt` se marca al confirmar.
 * - "Invalidates previous active tokens": `invalidatedAt` se marca cuando una
 *   nueva solicitud reemplaza al token.
 */
export interface EmailVerificationTokenRecord extends PersistedRecord {
  readonly userId: string
  readonly email: string
  readonly createdAt: number
  readonly expiresAt: number
  /** Marca de single-use: fecha de confirmación exitosa. */
  readonly consumedAt?: number
  /** Marca de reemplazo: una solicitud posterior invalidó este token. */
  readonly invalidatedAt?: number
}

/** Registro del índice de unicidad de emails: email normalizado → userId. */
export interface EmailIndexRecord extends PersistedRecord {
  readonly userId: string
}
