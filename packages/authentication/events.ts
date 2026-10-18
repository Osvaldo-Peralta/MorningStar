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
  TOKEN_REFRESHED: 'auth:token-refreshed',
  REFRESH_REUSE_DETECTED: 'auth:refresh-reuse-detected',
  PASSWORD_RESET_REQUESTED: 'auth:password-reset-requested',
  PASSWORD_RESET: 'auth:password-reset',
  MFA_ENROLLMENT_STARTED: 'auth:mfa-enrollment-started',
  MFA_ACTIVATED: 'auth:mfa-activated',
  MFA_DISABLED: 'auth:mfa-disabled',
  LOGIN_MFA_REQUIRED: 'auth:login-mfa-required',
} as const

export type LoginFailedReason =
  | 'invalid-credentials'
  | 'locked'
  | 'account-not-active'
  | 'invalid-mfa-code'

export interface PasswordSetPayload {
  readonly userId: string
}

export interface PasswordChangedPayload {
  readonly userId: string
  /** Campo aditivo 6c: sesiones revocadas por el cambio de contraseña. */
  readonly sessionsRevoked?: number
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

export interface TokenRefreshedPayload {
  readonly userId: string
  readonly sessionId: string
}

export interface RefreshReuseDetectedPayload {
  readonly userId: string
  readonly sessionId: string
}

export interface PasswordResetRequestedPayload {
  /** Ausente cuando el identifier no existe (anti-enumeración, ADR-0009). */
  readonly userId?: string
}

export interface PasswordResetPayload {
  readonly userId: string
  readonly sessionsRevoked: number
}

export interface MfaEnrollmentStartedPayload {
  readonly userId: string
}

export interface MfaActivatedPayload {
  readonly userId: string
}

export interface MfaDisabledPayload {
  readonly userId: string
}

export interface LoginMfaRequiredPayload {
  readonly userId: string
}
