// identity/domain/StatusTransitionPolicy.ts
import type { AccountStatus } from './AccountStatus.js'
import { InvalidStatusTransitionError } from '../errors.js'

/**
 * Tabla de transiciones de AccountStatus (Baseline v1.0 §1 + ADR-0005).
 *
 * Reglas de la Baseline que respaldan la tabla:
 * - "VERIFIED occurs upon email confirmation": PENDING_VERIFICATION → ACTIVE
 *   debe ser disparado por confirmEmail (Iteración 5); changeStatus lo permite
 *   a nivel de política pero el contrato lo documenta como flujo de sistema.
 * - "No automatic reactivation from SUSPENDED": SUSPENDED → ACTIVE solo por
 *   comando explícito (admin), nunca automático ni por verificación de email.
 * - "Re-auth required for sensitive changes": DEACTIVATED → ACTIVE requerirá
 *   re-autenticación cuando exista Authentication (Fase 4).
 * - BANNED es TERMINAL (decisión registrada en ADR-0005): un unban futuro
 *   exigiría un ADR nuevo + Audit Trail (Fase 8).
 *
 * Una transición al mismo estado NO es válida (no-op rechazado).
 */
export const STATUS_TRANSITIONS: Readonly<Record<AccountStatus, readonly AccountStatus[]>> = {
  PENDING_VERIFICATION: ['ACTIVE', 'SUSPENDED', 'DEACTIVATED', 'BANNED'],
  ACTIVE: ['SUSPENDED', 'DEACTIVATED', 'BANNED'],
  SUSPENDED: ['ACTIVE', 'DEACTIVATED', 'BANNED'],
  DEACTIVATED: ['ACTIVE', 'BANNED'],
  BANNED: [],
}

export function canTransition(from: AccountStatus, to: AccountStatus): boolean {
  if (from === to) return false
  return STATUS_TRANSITIONS[from].includes(to)
}

export function assertTransition(from: AccountStatus, to: AccountStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidStatusTransitionError(from, to)
  }
}
