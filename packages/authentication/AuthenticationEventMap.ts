// authentication/AuthenticationEventMap.ts
import type {
  AccountLockedPayload,
  LoginFailedPayload,
  LoginSucceededPayload,
  PasswordChangedPayload,
  PasswordResetPayload,
  PasswordResetRequestedPayload,
  PasswordSetPayload,
  RefreshReuseDetectedPayload,
  SessionIssuedPayload,
  SessionRevokedPayload,
  SessionsInvalidatedPayload,
  TokenRefreshedPayload,
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
  'auth:token-refreshed': TokenRefreshedPayload
  'auth:refresh-reuse-detected': RefreshReuseDetectedPayload
  'auth:password-reset-requested': PasswordResetRequestedPayload
  'auth:password-reset': PasswordResetPayload
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
    'auth:token-refreshed': TokenRefreshedPayload
    'auth:refresh-reuse-detected': RefreshReuseDetectedPayload
    'auth:password-reset-requested': PasswordResetRequestedPayload
    'auth:password-reset': PasswordResetPayload
  }
}
