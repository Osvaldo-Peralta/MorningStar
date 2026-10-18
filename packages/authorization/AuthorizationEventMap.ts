// authorization/AuthorizationEventMap.ts
import type {
  AuthzDecisionPayload,
  RoleAssignedPayload,
  RoleRevokedPayload,
} from './events.js'

/** Mapa de eventos del módulo Authorization (contrato público). */
export interface AuthorizationEventMap {
  'authz:decision': AuthzDecisionPayload
  'authz:role-assigned': RoleAssignedPayload
  'authz:role-revoked': RoleRevokedPayload
}

/**
 * Module augmentation (ADR-0002 §3): authorization aporta sus eventos al
 * contrato del Core sin que el Core dependa de este módulo.
 */
declare module '@morningstar/core' {
  interface CoreEventMap {
    'authz:decision': AuthzDecisionPayload
    'authz:role-assigned': RoleAssignedPayload
    'authz:role-revoked': RoleRevokedPayload
  }
}
