// authentication/domain/SessionRecord.ts
import type { PersistedRecord } from '@morningstar/core'

/**
 * Nivel de riesgo de la sesión (campo `riskSnapshot` de la Baseline v1.0 §2).
 * En la Iteración 6b nace en 'UNKNOWN': el Risk Engine (Fase 8) lo poblará
 * sin cambiar el esquema (forward-compatible).
 */
export type RiskLevel = 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'

export interface RiskSnapshot {
  readonly riskLevel: RiskLevel
  readonly assessedAt?: number
  readonly signals?: readonly string[]
}

/**
 * Sesión persistida (Baseline v1.0 §2: userId, deviceFingerprint, issuedAt,
 * expiresAt, riskSnapshot). Namespace: `auth:sessions`.
 *
 * Seguridad (ADR-0008): `id` = SHA-256(token opaco). El token en claro NUNCA
 * se persiste: se entrega una sola vez, en la emisión.
 */
export interface SessionRecord extends PersistedRecord {
  readonly userId: string
  readonly deviceFingerprint: string
  readonly issuedAt: number
  readonly expiresAt: number
  readonly lastSeenAt: number
  readonly riskSnapshot: RiskSnapshot
  readonly revokedAt?: number
  readonly revokedReason?: SessionRevokedReason
}

export type SessionRevokedReason =
  | 'logout'
  | 'logout-all'
  | 'mass-invalidation'
  | 'rotated'               // refresh con rotación completa (ADR-0009)
  | 'reuse-detected'        // refresh token robado/reutilizado (ADR-0009)
  | 'password-changed'
  | 'password-reset'
  | 'device-revoked'        // revocación remota por id desde "tus dispositivos" (8b)

/** Información de dispositivo aportada por el llamador en el login. */
export interface DeviceInfo {
  /** Identificador estable del dispositivo (lo calcula cada cliente). */
  readonly fingerprint: string
}

/** Modelo público de lectura de una sesión (nunca incluye el token). */
export interface SessionInfo {
  readonly sessionId: string
  readonly userId: string
  readonly deviceFingerprint: string
  readonly issuedAt: number
  readonly expiresAt: number
  readonly lastSeenAt: number
  readonly riskSnapshot: RiskSnapshot
}

export function toSessionInfo(record: SessionRecord): SessionInfo {
  return {
    sessionId: record.id,
    userId: record.userId,
    deviceFingerprint: record.deviceFingerprint,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    lastSeenAt: record.lastSeenAt,
    riskSnapshot: record.riskSnapshot,
  }
}
