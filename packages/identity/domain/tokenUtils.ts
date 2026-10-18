// identity/domain/tokenUtils.ts
//
// Generación y hashing de tokens de verificación (ADR-0006).
// Solo APIs nativas: crypto.getRandomValues + crypto.subtle (Node 20+ y
// navegadores en contexto seguro). El token en claro NUNCA se persiste:
// los records se guardan por su hash SHA-256.

const TOKEN_BYTES = 32

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

/** Token aleatorio de 256 bits en base64url (sin padding). */
export function generateTokenValue(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))
}

/** SHA-256 del token en hex — id determinístico y no reversible del record. */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
