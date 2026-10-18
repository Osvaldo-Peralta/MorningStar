// identity/IdentityEventMap.ts
import type {
  AccountTypeChangedPayload,
  ProfileUpdatedPayload,
  StatusChangedPayload,
  UserRegisteredPayload,
} from './events.js'

/** Mapa de eventos del módulo Identity (contrato público). */
export interface IdentityEventMap {
  'identity:registered': UserRegisteredPayload
  'identity:status-changed': StatusChangedPayload
  'identity:profile-updated': ProfileUpdatedPayload
  'identity:type-changed': AccountTypeChangedPayload
}

/**
 * Module augmentation (ADR-0002 §3): identity aporta sus eventos al contrato
 * del Core sin que el Core dependa de este módulo.
 */
declare module '@morningstar/core' {
  interface CoreEventMap {
    'identity:registered': UserRegisteredPayload
    'identity:status-changed': StatusChangedPayload
    'identity:profile-updated': ProfileUpdatedPayload
    'identity:type-changed': AccountTypeChangedPayload
  }
}
