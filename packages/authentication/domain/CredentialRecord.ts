// authentication/domain/CredentialRecord.ts
import type { PersistedRecord } from '@morningstar/core'

/**
 * Credenciales de un usuario. Namespace: `auth:credentials`.
 * `id` = userId (1:1 con el agregado User de identity).
 *
 * Seguridad: solo se persiste el hash auto-descriptivo (nunca el claro).
 * `failedAttempts`/`lockedUntil` implementan el lockout anti fuerza-bruta
 * (ADR-0007); el Risk Engine (Fase 8) los sofisticará.
 */
export interface CredentialRecord extends PersistedRecord {
  readonly passwordHash: string
  readonly failedAttempts: number
  readonly lockedUntil?: number
  readonly createdAt: number
  readonly updatedAt: number
}
