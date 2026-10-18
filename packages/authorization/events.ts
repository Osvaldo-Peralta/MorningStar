// authorization/events.ts
import type { AuthorizationDecision } from './domain/SecurityContext.js'

export const AUTHZ_EVENTS = {
  DECISION: 'authz:decision',
  ROLE_ASSIGNED: 'authz:role-assigned',
  ROLE_REVOKED: 'authz:role-revoked',
} as const

export interface AuthzDecisionPayload {
  readonly actorId: string
  readonly permission: string
  readonly decision: AuthorizationDecision
  readonly reason: string
}

export interface RoleAssignedPayload {
  readonly userId: string
  readonly roles: readonly string[]
}

export interface RoleRevokedPayload {
  readonly userId: string
  readonly role: string
}
