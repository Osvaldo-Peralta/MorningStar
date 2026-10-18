// identity/domain/AccountStatus.ts
//
// Ciclo de vida de cuenta definido en la Baseline v1.0 §1 (congelada).
// Const object (no enum) por erasableSyntaxOnly / type stripping (ADR de Iter 0.1).
export const AccountStatus = {
  PendingVerification: 'PENDING_VERIFICATION',
  Active: 'ACTIVE',
  Suspended: 'SUSPENDED',
  Deactivated: 'DEACTIVATED',
  Banned: 'BANNED',
} as const

export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus]
