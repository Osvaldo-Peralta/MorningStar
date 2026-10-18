// authentication/AuthenticationEventMap.ts
import type {
  AccountLockedPayload,
  LoginFailedPayload,
  LoginSucceededPayload,
  PasswordChangedPayload,
  PasswordSetPayload,
  SessionIssuedPayload,
  SessionRevokedPayload,
  SessionsInvalidatedPayload,
} from './events.js'

/** Mapa de eventos del módulo Authentication (contrato público). */
export interface AuthenticationEventMap {
  'auth:password-set': PasswordSetPayload
  'auth:password-changed': PasswordChangedPayload
  'auth:login-succeeded': LoginSucceededPayload
  'auth:login-failed': LoginFailedPayload
  'auth:account-locked': AccountLockedPayload
  'auth:session-issued': SessionIssuedPayload
  'auth:session-revoked': SessionRevokedPayload
  'auth:sessions-invalidated': SessionsInvalidatedPayload
}

/**
 * Module augmentation (ADR-0002 §3): authentication aporta sus eventos al
 * contrato del Core sin que el Core dependa de este módulo.
 */
declare module '@morningstar/core' {
  interface CoreEventMap {
    'auth:password-set': PasswordSetPayload
    'auth:password-changed': PasswordChangedPayload
    'auth:login-succeeded': LoginSucceededPayload
    'auth:login-failed': LoginFailedPayload
    'auth:account-locked': AccountLockedPayload
    'auth:session-issued': SessionIssuedPayload
    'auth:session-revoked': SessionRevokedPayload
    'auth:sessions-invalidated': SessionsInvalidatedPayload
  }
}
