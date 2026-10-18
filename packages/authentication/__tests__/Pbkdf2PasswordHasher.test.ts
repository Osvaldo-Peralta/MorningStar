import { describe, it, expect } from 'vitest'
import {
  Pbkdf2PasswordHasher,
  PBKDF2_DEFAULT_ITERATIONS,
} from '../infraestructure/Pbkdf2PasswordHasher.js'

// Iteraciones bajas en tests: la seguridad del parámetro se prueba por
// separado (el formato incluye las iteraciones reales de producción).
const fastHasher = () => new Pbkdf2PasswordHasher({ iterations: 1000 })

describe('Pbkdf2PasswordHasher', () => {
  it('genera hashes con formato PHC-like auto-descriptivo', async () => {
    const hash = await fastHasher().hash('correct horse battery staple')
    const parts = hash.split('$')

    expect(parts).toHaveLength(4)
    expect(parts[0]).toBe('pbkdf2-sha256')
    expect(parts[1]).toBe('1000')
    expect(parts[2]).toMatch(/^[A-Za-z0-9_-]+$/) // salt base64url
    expect(parts[3]).toMatch(/^[A-Za-z0-9_-]+$/) // digest base64url
  })

  it('verify: contraseña correcta = true, incorrecta = false', async () => {
    const hasher = fastHasher()
    const hash = await hasher.hash('MiClaveSegura1')

    expect(await hasher.verify('MiClaveSegura1', hash)).toBe(true)
    expect(await hasher.verify('miclavesegura1', hash)).toBe(false)
    expect(await hasher.verify('MiClaveSegura2', hash)).toBe(false)
    expect(await hasher.verify('', hash)).toBe(false)
  })

  it('la misma contraseña produce hashes distintos (salt única)', async () => {
    const hasher = fastHasher()
    const a = await hasher.hash('repetida')
    const b = await hasher.hash('repetida')

    expect(a).not.toBe(b)
    expect(await hasher.verify('repetida', a)).toBe(true)
    expect(await hasher.verify('repetida', b)).toBe(true)
  })

  it('verify respeta las iteraciones guardadas en el hash (crypto-agile)', async () => {
    const oldHasher = new Pbkdf2PasswordHasher({ iterations: 1234 })
    const hash = await oldHasher.hash('legado-ok')

    // Un hasher con defaults distintos verifica el hash viejo sin problemas
    const newHasher = new Pbkdf2PasswordHasher({ iterations: 4321 })
    expect(await newHasher.verify('legado-ok', hash)).toBe(true)
    expect(await newHasher.verify('legado-mal', hash)).toBe(false)
  })

  it('verify devuelve false (nunca lanza) ante hashes corruptos o de otro algoritmo', async () => {
    const hasher = fastHasher()

    expect(await hasher.verify('x', 'no-es-un-hash')).toBe(false)
    expect(await hasher.verify('x', 'argon2id$1$abc$def')).toBe(false)
    expect(await hasher.verify('x', 'pbkdf2-sha256$abc$c2FsdA$pG9hZA')).toBe(false) // iteraciones inválidas
    expect(await hasher.verify('x', '')).toBe(false)
  })

  it('el default de producción sigue la recomendación OWASP', () => {
    expect(PBKDF2_DEFAULT_ITERATIONS).toBe(600_000)
  })
})
