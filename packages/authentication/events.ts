// authentication/events.ts
import type { LoginRelevantAccountStatus } from './UserDirectoryPort.js'
import type { SessionRevokedReason } from './domain/SessionRecord.js'

export const AUTH_EVENTS = {
  PASSWORD_SET: 'auth:password-set',
  PASSWORD_CHANGED: 'auth:password-changed',
  LOGIN_SUCCEEDED: 'auth:login-succeeded',
  LOGIN_FAILED: 'auth:login-failed',
  ACCOUNT_LOCKED: 'auth:account-locked',
  SESSION_ISSUED: 'auth:session-issued',
  SESSION_REVOKED: 'auth:session-revoked',
  SESSIONS_INVALIDATED: 'auth:sessions-invalidated',
} as const

export type LoginFailedReason =
  | 'invalid-credentials'
  | 'locked'
  | 'account-not-active'

export interface PasswordSetPayload {
  readonly userId: string
}

export interface PasswordChangedPayload {
  readonly userId: string
}

export interface LoginSucceededPayload {
  readonly userId: string
}

export interface LoginFailedPayload {
  /** Ausente cuando el identificador no existe (anti-enumeración: el evento no filtra el identifier). */
  readonly userId?: string
  readonly reason: LoginFailedReason
  readonly failedAttempts?: number
  readonly accountStatus?: LoginRelevantAccountStatus
}

export interface AccountLockedPayload {
  readonly userId: string
  readonly lockedUntil: number
}

export interface SessionIssuedPayload {
  readonly userId: string
  readonly sessionId: string
  readonly deviceFingerprint: string
  readonly expiresAt: number
}

export interface SessionRevokedPayload {
  readonly sessionId: string
  readonly userId?: string
  readonly reason: SessionRevokedReason
}

export interface SessionsInvalidatedPayload {
  readonly count: number
  readonly reason: string
}
