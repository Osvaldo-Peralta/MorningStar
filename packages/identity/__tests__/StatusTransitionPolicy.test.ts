import { describe, it, expect } from 'vitest'
import { AccountStatus } from '../domain/AccountStatus.js'
import {
  STATUS_TRANSITIONS,
  canTransition,
  assertTransition,
} from '../domain/StatusTransitionPolicy.js'
import { InvalidStatusTransitionError } from '../errors.js'

describe('StatusTransitionPolicy (Baseline v1.0 §1)', () => {
  const all = Object.values(AccountStatus)

  it('PENDING_VERIFICATION → ACTIVE/SUSPENDED/DEACTIVATED/BANNED permitido', () => {
    expect(canTransition('PENDING_VERIFICATION', 'ACTIVE')).toBe(true)
    expect(canTransition('PENDING_VERIFICATION', 'SUSPENDED')).toBe(true)
    expect(canTransition('PENDING_VERIFICATION', 'DEACTIVATED')).toBe(true)
    expect(canTransition('PENDING_VERIFICATION', 'BANNED')).toBe(true)
  })

  it('ACTIVE → SUSPENDED/DEACTIVATED/BANNED permitido', () => {
    expect(canTransition('ACTIVE', 'SUSPENDED')).toBe(true)
    expect(canTransition('ACTIVE', 'DEACTIVATED')).toBe(true)
    expect(canTransition('ACTIVE', 'BANNED')).toBe(true)
  })

  it('SUSPENDED → ACTIVE solo por transición explícita (permitida por política)', () => {
    expect(canTransition('SUSPENDED', 'ACTIVE')).toBe(true)
    expect(canTransition('SUSPENDED', 'DEACTIVATED')).toBe(true)
    expect(canTransition('SUSPENDED', 'BANNED')).toBe(true)
  })

  it('DEACTIVATED → ACTIVE (recuperación) y BANNED permitidos', () => {
    expect(canTransition('DEACTIVATED', 'ACTIVE')).toBe(true)
    expect(canTransition('DEACTIVATED', 'BANNED')).toBe(true)
  })

  it('BANNED es terminal: ninguna transición de salida', () => {
    for (const to of all) {
      expect(canTransition('BANNED', to)).toBe(false)
    }
    expect(STATUS_TRANSITIONS.BANNED).toEqual([])
  })

  it('transiciones no permitidas: ACTIVE → PENDING_VERIFICATION y same-state', () => {
    expect(canTransition('ACTIVE', 'PENDING_VERIFICATION')).toBe(false)
    expect(canTransition('SUSPENDED', 'PENDING_VERIFICATION')).toBe(false)
    expect(canTransition('DEACTIVATED', 'PENDING_VERIFICATION')).toBe(false)
    for (const state of all) {
      expect(canTransition(state, state)).toBe(false)
    }
  })

  it('assertTransition lanza InvalidStatusTransitionError con from/to', () => {
    expect(() => assertTransition('BANNED', 'ACTIVE')).toThrow(InvalidStatusTransitionError)
    expect(() => assertTransition('BANNED', 'ACTIVE')).toThrow(/BANNED -> ACTIVE/)
  })

  it('assertTransition no lanza en transiciones válidas', () => {
    expect(() => assertTransition('PENDING_VERIFICATION', 'ACTIVE')).not.toThrow()
  })
})
