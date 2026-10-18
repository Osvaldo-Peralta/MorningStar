import { describe, it, expect } from 'vitest'
import { TotpService, TOTP_DEFAULTS } from '../domain/TotpService.js'
import { base32Encode, base32Decode } from '../domain/base32.js'

// Secret de los vectores oficiales de RFC 6238 (ASCII "12345678901234567890")
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('base32 (RFC 4648)', () => {
  it('codifica el valor conocido del RFC', () => {
    const ascii = new TextEncoder().encode('12345678901234567890')
    expect(base32Encode(ascii)).toBe(RFC_SECRET)
  })

  it('roundtrip de bytes aleatorios', () => {
    for (let length = 0; length < 40; length++) {
      const bytes = crypto.getRandomValues(new Uint8Array(length))
      expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(Array.from(bytes))
    }
  })

  it('decode acepta minúsculas, espacios y padding', () => {
    expect(Array.from(base32Decode('gezdgnbvgy3tqojqgezdgnbvgy3tqojq===='))).toEqual(
      Array.from(base32Decode(RFC_SECRET))
    )
    expect(Array.from(base32Decode('gezdgn bvgy3tqojqgezdgnbvgy3tqo jq'))).toEqual(
      Array.from(base32Decode(RFC_SECRET))
    )
  })

  it('decode rechaza caracteres fuera del alfabeto', () => {
    expect(() => base32Decode('0189')).toThrow(/inválido/)
  })
})

describe('TotpService — vectores oficiales RFC 6238 (SHA-1, 8 dígitos)', () => {
  const rfcService = (atSeconds: number) =>
    new TotpService({ digits: 8, now: () => atSeconds * 1000 })

  const vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ]

  for (const [seconds, expected] of vectors) {
    it(`T=${seconds}s → ${expected}`, async () => {
      expect(await rfcService(seconds).generateCode(RFC_SECRET)).toBe(expected)
    })
  }

  it('verifyCode acepta el código del step actual', async () => {
    const service = rfcService(59)
    expect(await service.verifyCode(RFC_SECRET, '94287082')).toBe(1) // step = floor(59/30)
  })

  it('verifyCode rechaza códigos incorrectos o mal formados', async () => {
    const service = rfcService(59)
    expect(await service.verifyCode(RFC_SECRET, '00000000')).toBeNull()
    expect(await service.verifyCode(RFC_SECRET, 'abcdefgh')).toBeNull()
    expect(await service.verifyCode(RFC_SECRET, '')).toBeNull()
  })
})

describe('TotpService — defaults y ventana', () => {
  it('defaults compatibles con apps authenticator (30 s, 6 dígitos, ±1)', () => {
    expect(TOTP_DEFAULTS.periodSeconds).toBe(30)
    expect(TOTP_DEFAULTS.digits).toBe(6)
    expect(TOTP_DEFAULTS.window).toBe(1)
  })

  it('generateSecret: 160 bits en base32 (32 caracteres del alfabeto)', () => {
    const secret = new TotpService().generateSecret()
    expect(secret).toMatch(/^[A-Z2-7]{32}$/)
    expect(new TotpService().generateSecret()).not.toBe(secret)
  })

  it('ventana ±1: acepta códigos de steps adyacentes y rechaza lejanos', async () => {
    const fixed = 1_700_000_010_000 // ms
    const service = new TotpService({ now: () => fixed })
    const code = await service.generateCode(RFC_SECRET)

    const verifyAt = (offsetMs: number) =>
      new TotpService({ now: () => fixed + offsetMs }).verifyCode(RFC_SECRET, code)

    expect(await verifyAt(0)).not.toBeNull()        // mismo step
    expect(await verifyAt(30_000)).not.toBeNull()   // +1 step (dentro de ventana)
    expect(await verifyAt(-30_000)).not.toBeNull()  // -1 step (dentro de ventana)
    expect(await verifyAt(90_000)).toBeNull()       // +3 steps (fuera)
    expect(await verifyAt(-90_000)).toBeNull()      // -3 steps (fuera)
  })

  it('generateTotpUri produce una URI otpauth:// estándar', () => {
    const uri = new TotpService().generateTotpUri(RFC_SECRET, 'osvaldo@morningstar.dev')
    expect(uri).toMatch(/^otpauth:\/\/totp\/MorningStar:osvaldo%40morningstar\.dev\?/)
    expect(uri).toContain(`secret=${RFC_SECRET}`)
    expect(uri).toContain('issuer=MorningStar')
    expect(uri).toContain('algorithm=SHA1')
    expect(uri).toContain('digits=6')
    expect(uri).toContain('period=30')
  })
})
