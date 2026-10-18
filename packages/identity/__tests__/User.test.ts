import { describe, it, expect } from 'vitest'
import { User } from '../domain/User.js'
import { AccountType } from '../domain/AccountType.js'
import { InvalidStatusTransitionError, InvalidAccountTypeConversionError, InvalidDisplayNameError } from '../errors.js'

const createUser = (overrides?: Partial<{ displayName: string; accountType: AccountType }>) =>
  User.create({
    id: 'u1',
    username: 'osvaldo42',
    email: 'osvaldo@test.dev',
    displayName: overrides?.displayName ?? 'Osvaldo Peralta',
    accountType: overrides?.accountType,
  })

describe('User (agregado)', () => {
  it('nace en PENDING_VERIFICATION, PERSONAL y sin email verificado', () => {
    const user = createUser()

    expect(user.accountStatus).toBe('PENDING_VERIFICATION')
    expect(user.accountType).toBe('PERSONAL')
    expect(user.verificationFlags).toEqual({ emailVerified: false })
    expect(user.createdAt).toBe(user.updatedAt)
  })

  it('changeStatus aplica la política y devuelve el estado anterior', () => {
    const user = createUser()

    const previous = user.changeStatus('ACTIVE')
    expect(previous).toBe('PENDING_VERIFICATION')
    expect(user.accountStatus).toBe('ACTIVE')
    expect(user.updatedAt).toBeGreaterThanOrEqual(user.createdAt)
  })

  it('changeStatus rechaza transiciones inválidas sin mutar estado', () => {
    const user = createUser()
    user.changeStatus('ACTIVE')
    user.changeStatus('BANNED')

    expect(() => user.changeStatus('ACTIVE')).toThrow(InvalidStatusTransitionError)
    expect(user.accountStatus).toBe('BANNED')
  })

  it('markEmailVerified activa el flag sin cambiar el estado', () => {
    const user = createUser()
    user.markEmailVerified()

    expect(user.verificationFlags.emailVerified).toBe(true)
    expect(user.accountStatus).toBe('PENDING_VERIFICATION')
  })

  it('updateDisplayName valida y devuelve el valor anterior', () => {
    const user = createUser()

    const previous = user.updateDisplayName('  Nuevo Nombre  ')
    expect(previous).toBe('Osvaldo Peralta')
    expect(user.displayName).toBe('Nuevo Nombre')
    expect(() => user.updateDisplayName('   ')).toThrow(InvalidDisplayNameError)
  })

  it('changeAccountType permite PERSONAL → CREATOR y bloquea → OFFICIAL', () => {
    const user = createUser()

    const previous = user.changeAccountType(AccountType.Creator)
    expect(previous).toBe('PERSONAL')
    expect(user.accountType).toBe('CREATOR')

    expect(() => user.changeAccountType(AccountType.Official)).toThrow(InvalidAccountTypeConversionError)
    expect(() => createUser().changeAccountType(AccountType.Government)).toThrow(InvalidAccountTypeConversionError)
  })

  it('toRecord/fromRecord hace roundtrip preservando identidad y estado', () => {
    const user = createUser({ accountType: AccountType.Creator })
    user.changeStatus('ACTIVE')
    user.markEmailVerified()

    const restored = User.fromRecord(user.toRecord())

    expect(restored.id).toBe(user.id)
    expect(restored.username).toBe(user.username)
    expect(restored.email).toBe(user.email)
    expect(restored.displayName).toBe(user.displayName)
    expect(restored.accountType).toBe(user.accountType)
    expect(restored.accountStatus).toBe(user.accountStatus)
    expect(restored.verificationFlags).toEqual(user.verificationFlags)
    expect(restored.createdAt).toBe(user.createdAt)
    expect(restored.updatedAt).toBe(user.updatedAt)
  })

  it('no filtra estado interno al serializar (solo el campo público id)', () => {
    const user = createUser()
    const parsed = JSON.parse(JSON.stringify(user))

    // Ni los campos #privados ni los getters aparecen en JSON: solo `id`
    expect(parsed).toEqual({ id: user.id })
  })
})
