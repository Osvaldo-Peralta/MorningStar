// authentication/domain/MfaRecord.ts
import type { PersistedRecord } from '@morningstar/core'

export type MfaRecordStatus = 'pending' | 'active'

/**
 * Estado MFA de un usuario. Namespace: `auth:mfa` (`id` = userId).
 *
 * ⚠️ Deuda de seguridad deliberada (ADR-0010): el secret TOTP se almacena en
 * claro porque el servidor necesita recomputar códigos (a diferencia de
 * passwords/tokens, no es one-way). Sin backend no hay gestión de claves
 * real; el backend de producción debe cifrarlo en reposo (KMS/env-secret).
 * Los backup codes SÍ se almacenan hasheados (SHA-256, one-way).
 */
export interface MfaRecord extends PersistedRecord {
  readonly status: MfaRecordStatus
  /** Secret activo (base32) cuando status === 'active'. */
  readonly secret?: string
  /** Secret del enrolamiento en curso (status === 'pending'). */
  readonly pendingSecret?: string
  /** Último step TOTP aceptado (anti-replay). */
  readonly lastAcceptedStep?: number
  /** Hashes SHA-256 de los backup codes aún no consumidos. */
  readonly backupCodeHashes?: readonly string[]
  readonly createdAt: number
  readonly updatedAt: number
}

/**
 * Challenge de segundo factor emitido por `login` cuando la cuenta tiene MFA
 * activo (ADR-0010). Namespace: `auth:mfa-challenges` (`id` = SHA-256 del
 * mfaToken opaco). Single-use, TTL corto, guarda el fingerprint del intento
 * para no pedirlo de nuevo en `completeMfaLogin`.
 */
export interface MfaChallengeRecord extends PersistedRecord {
  readonly userId: string
  readonly deviceFingerprint: string
  readonly createdAt: number
  readonly expiresAt: number
  readonly consumedAt?: number
  /** Intentos de código fallidos; al alcanzar el máximo el challenge muere. */
  readonly attempts: number
}

/** Resultado del enrolamiento: el secret se muestra UNA sola vez. */
export interface MfaEnrollment {
  readonly secret: string
  readonly otpauthUri: string
}

/** Resultado de la activación: los backup codes se muestran UNA sola vez. */
export interface MfaActivation {
  readonly backupCodes: readonly string[]
}

export interface MfaStatus {
  readonly enrolled: boolean
  readonly active: boolean
}
