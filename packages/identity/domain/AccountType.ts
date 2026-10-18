// identity/domain/AccountType.ts
import { InvalidAccountTypeConversionError } from '../errors.js'

// Tipos de cuenta de la Baseline v1.0 §1
export const AccountType = {
  Personal: 'PERSONAL',
  Creator: 'CREATOR',
  Official: 'OFFICIAL',
  Government: 'GOVERNMENT',
} as const

export type AccountType = (typeof AccountType)[keyof typeof AccountType]

/**
 * Política de conversión MVP (ADR-0005):
 * - PERSONAL ↔ CREATOR: permitido (upgrade y downgrade de creador).
 * - Hacia/desde OFFICIAL y GOVERNMENT: bloqueado hasta que exista el flujo de
 *   verificación correspondiente (Fase 3+, Iteración 5 / verificación email).
 */
export const ACCOUNT_TYPE_CONVERSIONS: Readonly<Record<AccountType, readonly AccountType[]>> = {
  PERSONAL: ['CREATOR'],
  CREATOR: ['PERSONAL'],
  OFFICIAL: [],
  GOVERNMENT: [],
}

export function canConvertAccountType(from: AccountType, to: AccountType): boolean {
  return ACCOUNT_TYPE_CONVERSIONS[from].includes(to)
}

export function assertAccountTypeConversion(from: AccountType, to: AccountType): void {
  if (!canConvertAccountType(from, to)) {
    throw new InvalidAccountTypeConversionError(from, to)
  }
}
