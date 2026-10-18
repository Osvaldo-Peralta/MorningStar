import { describe, it, expect } from 'vitest'
import {
  normalizeUsername,
  validateUsername,
  USERNAME_LIMITS,
} from '../domain/usernamePolicy.js'
import { validateDisplayName, DISPLAY_NAME_LIMITS } from '../domain/displayNamePolicy.js'
import { InvalidUsernameError, InvalidDisplayNameError } from '../errors.js'

describe('usernamePolicy', () => {
  it('normaliza: trim + lowercase', () => {
    expect(normalizeUsername('  OsvaldoDev  ')).toBe('osvaldodev')
    expect(normalizeUsername('USER42')).toBe('user42')
  })

  it('acepta usernames alfanuméricos válidos', () => {
    expect(validateUsername('osvaldo2026')).toBe('osvaldo2026')
    expect(validateUsername('  MiUsuario42 ')).toBe('miusuario42')
  })

  it('rechaza caracteres no alfanuméricos', () => {
    expect(() => validateUsername('con_guion_bajo')).toThrow(InvalidUsernameError)
    expect(() => validateUsername('con.punto')).toThrow(InvalidUsernameError)
    expect(() => validateUsername('con espacio')).toThrow(/alphanumeric/)
    expect(() => validateUsername('ñandú123')).toThrow(InvalidUsernameError)
  })

  it('respeta los límites de longitud', () => {
    const tooShort = 'a'.repeat(USERNAME_LIMITS.minLength - 1)
    const tooLong = 'a'.repeat(USERNAME_LIMITS.maxLength + 1)
    expect(() => validateUsername(tooShort)).toThrow(/3-32/)
    expect(() => validateUsername(tooLong)).toThrow(/3-32/)
    expect(validateUsername('a'.repeat(USERNAME_LIMITS.minLength))).toHaveLength(USERNAME_LIMITS.minLength)
  })
})

describe('displayNamePolicy', () => {
  it('acepta Unicode completo y hace trim', () => {
    expect(validateDisplayName('  Osvaldo Peralta ✨ ')).toBe('Osvaldo Peralta ✨')
    expect(validateDisplayName('日本語ユーザー')).toBe('日本語ユーザー')
  })

  it('mide en code points (emojis astrales cuentan 1)', () => {
    const emojis = '🚀'.repeat(DISPLAY_NAME_LIMITS.maxLength) // 100 code points
    expect(validateDisplayName(emojis)).toBe(emojis)
    expect(() => validateDisplayName(emojis + '🚀')).toThrow(InvalidDisplayNameError)
  })

  it('rechaza vacío o solo espacios', () => {
    expect(() => validateDisplayName('')).toThrow(/must not be empty/)
    expect(() => validateDisplayName('   ')).toThrow(InvalidDisplayNameError)
  })
})
