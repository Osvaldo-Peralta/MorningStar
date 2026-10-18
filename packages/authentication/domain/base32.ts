// authentication/domain/base32.ts
//
// Codificación base32 (RFC 4648, alfabeto estándar) para secrets TOTP.
// Sin padding al codificar (convención de las URIs otpauth:// y las apps
// authenticator); el decode acepta entrada con o sin padding.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0
  let value = 0
  let output = ''

  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

export function base32Decode(input: string): Uint8Array {
  const cleaned = input.toUpperCase().replace(/[\s=-]/g, '')

  let bits = 0
  let value = 0
  const output: number[] = []

  for (const char of cleaned) {
    const index = ALPHABET.indexOf(char)
    if (index === -1) {
      throw new Error(`base32Decode: carácter inválido '${char}'`)
    }
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }

  return new Uint8Array(output)
}
