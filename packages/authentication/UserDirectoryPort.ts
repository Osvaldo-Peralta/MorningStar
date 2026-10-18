// authentication/UserDirectoryPort.ts

/**
 * Puerto de directorio de usuarios (ADR-0007, extendido en 6c/ADR-0009).
 *
 * Permite resolver el identificador de login (username o email) a un userId
 * + estatus + email de contacto SIN que authentication importe identity
 * (feature ↔ feature está prohibido — ADR-0002). La composición
 * (bootstrap/backend) cablea este puerto con un adaptador basado en
 * IdentityModule.
 *
 * Los valores de `accountStatus` son los strings del contrato de identity
 * (duplicación deliberada del wire-format para mantener el desacoplamiento;
 * se documenta en ADR-0007).
 */
export type LoginRelevantAccountStatus =
  | 'PENDING_VERIFICATION'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'DEACTIVATED'
  | 'BANNED'

export interface UserDirectoryEntry {
  readonly userId: string
  readonly accountStatus: LoginRelevantAccountStatus
  /** Email de contacto para flujos de seguridad (reset de contraseña). */
  readonly email: string
}

export interface UserDirectoryPort {
  /** Recibe el identificador tal cual lo escribió el usuario (username o email). */
  lookupUser(identifier: string): Promise<UserDirectoryEntry | null>
  /** Resolución directa por userId (refresh de sesión, reset de contraseña). */
  getUserAccount(userId: string): Promise<UserDirectoryEntry | null>
}
