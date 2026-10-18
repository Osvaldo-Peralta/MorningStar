// authentication/infraestructure/Pbkdf2PasswordHasher.ts
import type { PasswordHasher } from '../PasswordHasher.js'
import { base64UrlEncode, base64UrlDecode } from './base64Url.js'

const ALGORITHM = 'pbkdf2-sha256'

/**
 * Iteraciones por defecto: recomendación OWASP (2023) para PBKDF2-HMAC-SHA256.
 * Inyectables por constructor: los tests usan valores bajos; un despliegue
 * puede subirlos sin invalidar hashes existentes (las iteraciones viajan en
 * el propio hash).
 */
export const PBKDF2_DEFAULT_ITERATIONS = 600_000

export interface Pbkdf2PasswordHasherOptions {
  readonly iterations?: number
  readonly saltBytes?: number
  readonly keyLengthBytes?: number
}

/** Comparación en tiempo constante (mitigación de timing attacks). */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false
  let diff = 0
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i]! ^ b[i]!
  }
  return diff === 0
}

/**
 * Adaptador `PasswordHasher` con PBKDF2-HMAC-SHA256 sobre WebCrypto
 * (`crypto.subtle`): nativo en Node 20+ y navegadores, cero dependencias,
 * isomórfico (ADR-0007).
 *
 * Formato del hash: `pbkdf2-sha256$<iterations>$<salt-b64url>$<digest-b64url>`
 *
 * Nota: en navegador `crypto.subtle` exige contexto seguro (https o
 * localhost) — dev cumple; producción será https.
 */
export class Pbkdf2PasswordHasher implements PasswordHasher {
  private readonly iterations: number
  private readonly saltBytes: number
  private readonly keyLengthBytes: number

  constructor(options: Pbkdf2PasswordHasherOptions = {}) {
    this.iterations = options.iterations ?? PBKDF2_DEFAULT_ITERATIONS
    this.saltBytes = options.saltBytes ?? 16
    this.keyLengthBytes = options.keyLengthBytes ?? 32
  }

  async hash(password: string): Promise<string> {
    const salt = crypto.getRandomValues(new Uint8Array(this.saltBytes))
    const digest = await this.derive(password, salt, this.iterations, this.keyLengthBytes)
    return `${ALGORITHM}$${this.iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(digest)}`
  }

  async verify(password: string, hash: string): Promise<boolean> {
    const parts = hash.split('$')
    if (parts.length !== 4 || parts[0] !== ALGORITHM) {
      return false // formato desconocido/corrupto: no verifica, nunca lanza
    }

    const iterations = Number(parts[1])
    if (!Number.isInteger(iterations) || iterations <= 0) return false

    let salt: Uint8Array
    let expected: Uint8Array
    try {
      salt = base64UrlDecode(parts[2]!)
      expected = base64UrlDecode(parts[3]!)
    } catch {
      return false
    }

    const digest = await this.derive(password, salt, iterations, expected.byteLength)
    return timingSafeEqual(digest, expected)
  }

  private async derive(
    password: string,
    salt: Uint8Array,
    iterations: number,
    keyLengthBytes: number
  ): Promise<Uint8Array> {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    )
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: salt as unknown as BufferSource, iterations },
      keyMaterial,
      keyLengthBytes * 8
    )
    return new Uint8Array(bits)
  }
}
