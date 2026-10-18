// authorization/domain/RoleAssignmentRecord.ts
import type { PersistedRecord } from '@morningstar/core'

/**
 * Asignación de roles por usuario (ADR-0011).
 * Namespace: `authorization:role-assignments` (`id` = userId).
 *
 * Ausencia de record ⇒ rol por defecto según estado de cuenta
 * (ACTIVE → 'member'; otro → 'guest').
 */
export interface RoleAssignmentRecord extends PersistedRecord {
  readonly roles: readonly string[]
  readonly updatedAt: number
}
