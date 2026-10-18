// authentication/infraestructure/sessionToken.ts
//
// Generación y hashing de tokens opacos de sesión (ADR-0008).
// Mismo patrón de seguridad que los tokens de email (ADR-0006): el claro se
// entrega una vez, el almacén solo conoce su SHA-256.
// Nota: duplicación deliberada de utils criptográficos con identity — si un
// tercer módulo los necesita, se extraen a core (regla de tres).
import { base64UrlEncode } from './base64Url.js'

const TOKEN_BYTES = 32

/** Token opaco de 256 bits en base64url (sin padding). */
export function generateOpaqueToken(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)))
}

/** SHA-256 del token en hex — id determinístico y no reversible del record. */
export async function hashOpaqueToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}
