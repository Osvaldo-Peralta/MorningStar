// identity/domain/UserRecord.ts
import type { PersistedRecord } from '@morningstar/core'
import type { AccountStatus } from './AccountStatus.js'
import type { AccountType } from './AccountType.js'

/** Flags de verificación del usuario (Baseline v1.0 §1: verificationFlags). */
export interface VerificationFlags {
  readonly emailVerified: boolean
}

/**
 * Proyección serializable del agregado `User` (ADR-0003).
 * Namespace del repositorio: `identity:users`.
 */
export interface UserRecord extends PersistedRecord {
  /** Username normalizado (lowercase, alfanumérico) — único globalmente. */
  readonly username: string
  readonly displayName: string
  readonly accountType: AccountType
  readonly accountStatus: AccountStatus
  readonly verificationFlags: VerificationFlags
  readonly createdAt: number
  readonly updatedAt: number
}
