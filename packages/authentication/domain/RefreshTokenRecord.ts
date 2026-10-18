// authentication/domain/RefreshTokenRecord.ts
import type { PersistedRecord } from '@morningstar/core'

/**
 * Refresh token con rotación (ADR-0009). Namespace: `auth:refresh-tokens`.
 *
 * Seguridad: `id` = SHA-256(token); el claro se entrega una sola vez en el
 * LoginResult. `consumedAt` + `rotatedToHash` forman el lineage de rotación;
 * presentar un token ya consumido dispara la detección de reuso (posible
 * robo) que revoca la sesión asociada.
 */
export interface RefreshTokenRecord extends PersistedRecord {
  readonly userId: string
  /** Sesión a la que pertenece este refresh token. */
  readonly sessionId: string
  readonly issuedAt: number
  readonly expiresAt: number
  /** Marcado al rotar (single-use por rotación). */
  readonly consumedAt?: number
  /** Hash del refresh token que reemplazó a este (lineage). */
  readonly rotatedToHash?: string
  readonly revokedAt?: number
  readonly revokedReason?: string
}
