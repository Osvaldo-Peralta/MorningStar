// authentication/PasswordHasher.ts

/**
 * Puerto de hashing de contraseñas (ADR-0007).
 *
 * El hash es una cadena auto-descriptiva (formato PHC-like):
 * `<algoritmo>$<parametros>$<salt>$<digest>`. El algoritmo viaja dentro del
 * hash ⇒ crypto-agile: se puede migrar de algoritmo (ej. PBKDF2 → Argon2id)
 * verificando el formato antiguo y re-hasheando en el próximo login exitoso,
 * sin invalidar contraseñas existentes.
 *
 * Contrato:
 * - `hash` usa salt aleatoria única por llamada.
 * - `verify` compara en tiempo constante y devuelve `false` (nunca lanza)
 *   ante hashes de formato desconocido/corrupto.
 * - La contraseña en claro nunca se persiste ni se loguea.
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>
  verify(password: string, hash: string): Promise<boolean>
}
