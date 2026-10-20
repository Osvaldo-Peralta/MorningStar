// messaging/domain/messagingPolicy.ts
// Política del módulo (const object, sin enums — ESM canónico). Los límites
// son defaults sensatos tipo "chat de superapp"; la composición puede
// ajustarlos por instancia vía `MessagingModuleOptions.policy`.

export interface MessagingPolicy {
  /** Longitud máxima del cuerpo de un mensaje (tras trim). */
  readonly maxBodyLength: number
  /** Participantes mínimos de toda conversación (direct: exactamente 2). */
  readonly minParticipants: number
  /** Participantes máximos de una conversación grupal. */
  readonly maxParticipants: number
  /** Longitud máxima del título de un grupo (tras trim). */
  readonly maxTitleLength: number
  /** Tamaño de página por defecto de `listMessages`. */
  readonly defaultPageSize: number
  /** Tamaño de página máximo de `listMessages`. */
  readonly maxPageSize: number
}

export const MESSAGING_POLICY: MessagingPolicy = {
  maxBodyLength: 4000,
  minParticipants: 2,
  maxParticipants: 100,
  maxTitleLength: 100,
  defaultPageSize: 50,
  maxPageSize: 200,
} as const

export interface MessagingPolicyOverrides {
  readonly maxBodyLength?: number
  readonly minParticipants?: number
  readonly maxParticipants?: number
  readonly maxTitleLength?: number
  readonly defaultPageSize?: number
  readonly maxPageSize?: number
}

export function resolveMessagingPolicy(
  overrides: MessagingPolicyOverrides = {}
): MessagingPolicy {
  return { ...MESSAGING_POLICY, ...overrides }
}

/** Clave canónica del par de usuarios de una conversación directa (dedup). */
export function directPairKey(userA: string, userB: string): string {
  return [userA, userB].sort().join('::')
}
