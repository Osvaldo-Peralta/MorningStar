// authentication/UserDirectoryPort.ts

/**
 * Puerto de directorio de usuarios (ADR-0007).
 *
 * Permite resolver el identificador de login (username o email) a un userId
 * + estatus de cuenta SIN que authentication importe identity (feature ↔
 * feature está prohibido — ADR-0002). La composición (bootstrap/backend)
 * cablea este puerto con un adaptador basado en IdentityModule.
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
}

export interface UserDirectoryPort {
  /** Recibe el identificador tal cual lo escribió el usuario (username o email). */
  lookupUser(identifier: string): Promise<UserDirectoryEntry | null>
}
