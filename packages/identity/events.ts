// identity/events.ts
import type { AccountStatus } from './domain/AccountStatus.js'
import type { AccountType } from './domain/AccountType.js'

export const IDENTITY_EVENTS = {
  REGISTERED: 'identity:registered',
  STATUS_CHANGED: 'identity:status-changed',
  PROFILE_UPDATED: 'identity:profile-updated',
  TYPE_CHANGED: 'identity:type-changed',
  VERIFICATION_REQUESTED: 'identity:verification-requested',
  EMAIL_VERIFIED: 'identity:email-verified',
} as const

export interface UserRegisteredPayload {
  readonly userId: string
  readonly username: string
  readonly accountType: AccountType
  readonly accountStatus: AccountStatus
}

export interface StatusChangedPayload {
  readonly userId: string
  readonly from: AccountStatus
  readonly to: AccountStatus
  /** Motivo opcional (moderación, solicitud del usuario, demo…). */
  readonly reason?: string
}

export interface ProfileUpdatedPayload {
  readonly userId: string
  readonly displayName: string
}

export interface AccountTypeChangedPayload {
  readonly userId: string
  readonly from: AccountType
  readonly to: AccountType
}

export interface VerificationRequestedPayload {
  readonly userId: string
  readonly email: string
  readonly expiresAt: number
}

export interface EmailVerifiedPayload {
  readonly userId: string
  readonly email: string
}
