// authentication/domain/TotpService.ts
//
// TOTP (RFC 6238) sobre HMAC-SHA1 con WebCrypto: zero-dependencies e
// isomórfico (Node 20+ / navegadores). Parámetros por defecto compatibles
// con Google Authenticator, Authy, 1Password, etc.
//
// Testeable de forma determinista: el reloj es inyectable (`now`) y los
// tests se validan contra los vectores oficiales de RFC 6238.
import { base32Decode, base32Encode } from './base32.js'

export const TOTP_DEFAULTS = {
  periodSeconds: 30,
  digits: 6,
  window: 1,           // ±1 paso de tolerancia (drift de reloj)
  secretBytes: 20,     // 160 bits (RFC 4226 §4: mínimo para SHA-1)
} as const

export interface TotpServiceOptions {
  readonly periodSeconds?: number
  readonly digits?: number
  readonly window?: number
  /** Reloj inyectable (ms epoch). Default: Date.now. */
  readonly now?: () => number
}

export const TOTP_ISSUER = 'MorningStar'

export class TotpService {
  private readonly periodSeconds: number
  private readonly digits: number
  private readonly window: number
  private readonly now: () => number

  constructor(options: TotpServiceOptions = {}) {
    this.periodSeconds = options.periodSeconds ?? TOTP_DEFAULTS.periodSeconds
    this.digits = options.digits ?? TOTP_DEFAULTS.digits
    this.window = options.window ?? TOTP_DEFAULTS.window
    this.now = options.now ?? (() => Date.now())
  }

  /** Secret nuevo: 160 bits aleatorios en base32 (sin padding). */
  generateSecret(): string {
    return base32Encode(crypto.getRandomValues(new Uint8Array(TOTP_DEFAULTS.secretBytes)))
  }

  /** Código TOTP vigente (o en `atMs`) para el secret dado. */
  async generateCode(secretBase32: string, atMs: number = this.now()): Promise<string> {
    const step = this.stepFor(atMs)
    return this.codeForStep(secretBase32, step)
  }

  /**
   * Verifica un código dentro de la ventana ±window.
   * Devuelve el step que matcheó (para anti-replay del módulo) o `null`.
   */
  async verifyCode(
    secretBase32: string,
    code: string,
    atMs: number = this.now()
  ): Promise<number | null> {
    if (!/^\d+$/.test(code)) return null

    const currentStep = this.stepFor(atMs)
    for (let offset = -this.window; offset <= this.window; offset++) {
      const step = currentStep + offset
      if (step < 0) continue
      const expected = await this.codeForStep(secretBase32, step)
      if (this.constantTimeEquals(expected, code)) {
        return step
      }
    }
    return null
  }

  /** URI otpauth:// para renderizar como QR en el cliente (sin dependencias). */
  generateTotpUri(
    secretBase32: string,
    accountName: string,
    issuer: string = TOTP_ISSUER
  ): string {
    const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`
    const params = new URLSearchParams({
      secret: secretBase32,
      issuer,
      algorithm: 'SHA1',
      digits: String(this.digits),
      period: String(this.periodSeconds),
    })
    return `otpauth://totp/${label}?${params.toString()}`
  }

  private stepFor(atMs: number): number {
    return Math.floor(atMs / 1000 / this.periodSeconds)
  }

  private async codeForStep(secretBase32: string, step: number): Promise<string> {
    const key = base32Decode(secretBase32)

    // Contador de 64 bits big-endian (RFC 4226 §5.2)
    const counter = new Uint8Array(8)
    let remaining = BigInt(step)
    for (let i = 7; i >= 0; i--) {
      counter[i] = Number(remaining & 0xffn)
      remaining >>= 8n
    }

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      key as unknown as BufferSource,
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign']
    )
    const hmac = new Uint8Array(
      await crypto.subtle.sign('HMAC', cryptoKey, counter as unknown as BufferSource)
    )

    // Truncamiento dinámico (RFC 4226 §5.3)
    const offset = hmac[hmac.length - 1]! & 0x0f
    const binary =
      ((hmac[offset]! & 0x7f) << 24) |
      ((hmac[offset + 1]!) << 16) |
      ((hmac[offset + 2]!) << 8) |
      hmac[offset + 3]!
    const otp = binary % 10 ** this.digits
    return otp.toString().padStart(this.digits, '0')
  }

  private constantTimeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) {
      diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    }
    return diff === 0
  }
}
