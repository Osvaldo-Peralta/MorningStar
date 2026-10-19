// web/src/context/AuthContext.tsx
/*
--- Estado de sesión del navegador (ADR-0013) + gestión de cuenta (8b):
--- MFA, cambio/reset de contraseña y "tus dispositivos".
--- Patrón SPA sin backend HTTP: el refresh token vive en localStorage
--- (deuda documentada: httpOnly cookies cuando exista backend).
*/
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useApp, webDeviceFingerprint } from './AppContext';
import { MfaRequiredError, AccountNotActiveError } from '@morningstar/authentication';
import type {
  MfaActivation,
  MfaEnrollment,
  MfaStatus,
  SessionInfo,
} from '@morningstar/authentication';
import type { UserSnapshot } from '@morningstar/identity';
import type { ActorContext } from '@morningstar/core';

const RT_STORAGE_KEY = 'morningstar_v0.3.0_refresh';

export type AuthStatus = 'loading' | 'anonymous' | 'authenticated';

/** Resultado discriminado de los flujos de autenticación (para la UI). */
export type AuthOutcome =
  | { kind: 'ok' }
  | { kind: 'mfa-required'; mfaToken: string }
  | { kind: 'pending-verification' }
  | { kind: 'error'; message: string };

/** Resultado discriminado de las operaciones de gestión de cuenta (8b). */
export type SecurityResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; message: string };

interface AuthContextValue {
  status: AuthStatus;
  user: UserSnapshot | null;
  sessionToken: string | null;
  /** Id de la sesión vigente (marca "este dispositivo" en la lista de sesiones). */
  sessionId: string | null;
  /** ActorContext para los comandos de dominio (fail-closed, ADR-0012). */
  actor: ActorContext | null;
  /** Aviso transitorio para el AuthScreen (p. ej. "contraseña cambiada"). */
  notice: string | null;
  clearNotice(): void;
  register(input: { username: string; email: string; displayName: string }, password: string): Promise<AuthOutcome>;
  login(identifier: string, password: string): Promise<AuthOutcome>;
  completeMfa(mfaToken: string, code: string): Promise<AuthOutcome>;
  requestVerification(identifier: string): Promise<AuthOutcome>;
  confirmEmail(token: string): Promise<AuthOutcome>;
  logout(): Promise<void>;
  // 8b — gestión de cuenta (requieren sesión, salvo request/reset de contraseña)
  changePassword(currentPassword: string, newPassword: string): Promise<SecurityResult>;
  requestPasswordReset(identifier: string): Promise<SecurityResult>;
  resetPassword(token: string, newPassword: string): Promise<SecurityResult>;
  getMfaStatus(): Promise<SecurityResult<MfaStatus>>;
  enrollMfa(): Promise<SecurityResult<MfaEnrollment>>;
  confirmMfa(code: string): Promise<SecurityResult<MfaActivation>>;
  disableMfa(code: string): Promise<SecurityResult>;
  listSessions(): Promise<SessionInfo[]>;
  revokeSession(sessionId: string): Promise<boolean>;
}

const AuthCtx = createContext<AuthContextValue | null>(null);

const errMessage = (e: unknown, fallback: string): string =>
  e instanceof Error ? e.message : fallback;

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { identity, authentication } = useApp();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<UserSnapshot | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const adoptSession = useCallback(
    async (result: {
      userId: string;
      session: { token: string; sessionId: string };
      refreshToken: string;
    }) => {
      localStorage.setItem(RT_STORAGE_KEY, result.refreshToken);
      setSessionToken(result.session.token);
      setSessionId(result.session.sessionId);
      setUser(await identity.getUser(result.userId));
      setStatus('authenticated');
    },
    [identity]
  );

  /** Limpia el estado local de sesión (el servidor ya no la reconoce). */
  const clearLocalSession = useCallback(() => {
    localStorage.removeItem(RT_STORAGE_KEY);
    setSessionToken(null);
    setSessionId(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  // Restauración de sesión al cargar: refresh con el RT persistido
  useEffect(() => {
    const restore = async () => {
      const refreshToken = localStorage.getItem(RT_STORAGE_KEY);
      if (!refreshToken) {
        setStatus('anonymous');
        return;
      }
      try {
        await adoptSession(await authentication.refresh(refreshToken));
      } catch {
        localStorage.removeItem(RT_STORAGE_KEY);
        setStatus('anonymous');
      }
    };
    restore().catch(() => setStatus('anonymous'));
  }, [authentication, adoptSession]);

  const register = useCallback<AuthContextValue['register']>(
    async (input, password) => {
      try {
        const snapshot = await identity.registerUser(input);
        await authentication.setPassword(snapshot.id, password);
        await identity.requestEmailVerification(snapshot.id);
        return { kind: 'pending-verification' };
      } catch (e) {
        return { kind: 'error', message: errMessage(e, 'Error en el registro') };
      }
    },
    [identity, authentication]
  );

  const login = useCallback<AuthContextValue['login']>(
    async (identifier, password) => {
      try {
        await adoptSession(
          await authentication.login(identifier, password, {
            fingerprint: webDeviceFingerprint(),
          })
        );
        return { kind: 'ok' };
      } catch (e) {
        if (e instanceof MfaRequiredError) {
          return { kind: 'mfa-required', mfaToken: e.mfaToken };
        }
        if (e instanceof AccountNotActiveError && e.accountStatus === 'PENDING_VERIFICATION') {
          // Reenviamos la verificación para que el usuario pueda completarla
          try {
            await identity.requestEmailVerification(
              ((await identity.getByUsername(identifier)) ?? (await identity.getByEmail(identifier)))!.id
            );
          } catch {
            /* el usuario igual verá el estado pendiente */
          }
          return { kind: 'pending-verification' };
        }
        return { kind: 'error', message: errMessage(e, 'Error en el login') };
      }
    },
    [authentication, identity, adoptSession]
  );

  const completeMfa = useCallback<AuthContextValue['completeMfa']>(
    async (mfaToken, code) => {
      try {
        await adoptSession(await authentication.completeMfaLogin(mfaToken, code));
        return { kind: 'ok' };
      } catch (e) {
        return { kind: 'error', message: errMessage(e, 'Código inválido') };
      }
    },
    [authentication, adoptSession]
  );

  const requestVerification = useCallback<AuthContextValue['requestVerification']>(
    async (identifier) => {
      try {
        const snapshot =
          (await identity.getByUsername(identifier)) ?? (await identity.getByEmail(identifier));
        if (!snapshot) return { kind: 'error', message: 'Cuenta no encontrada' };
        await identity.requestEmailVerification(snapshot.id);
        return { kind: 'pending-verification' };
      } catch (e) {
        return { kind: 'error', message: errMessage(e, 'Error al solicitar verificación') };
      }
    },
    [identity]
  );

  const confirmEmail = useCallback<AuthContextValue['confirmEmail']>(
    async (token) => {
      try {
        await identity.confirmEmail(token);
        return { kind: 'ok' };
      } catch (e) {
        return { kind: 'error', message: errMessage(e, 'Token inválido') };
      }
    },
    [identity]
  );

  const logout = useCallback(async () => {
    if (sessionToken) {
      try {
        await authentication.logout(sessionToken);
      } catch {
        /* best-effort */
      }
    }
    clearLocalSession();
  }, [authentication, sessionToken, clearLocalSession]);

  // ── 8b: gestión de cuenta ──────────────────────────────────────────────

  const changePassword = useCallback<AuthContextValue['changePassword']>(
    async (currentPassword, newPassword) => {
      if (!user) return { ok: false, message: 'No hay sesión autenticada' };
      try {
        await authentication.changePassword(user.id, currentPassword, newPassword);
        // El backend revocó TODAS las sesiones ('password-changed', ADR-0009):
        // limpiamos el estado local y avisamos en el AuthScreen.
        clearLocalSession();
        setNotice('Contraseña cambiada. Vuelve a iniciar sesión.');
        return { ok: true, value: undefined };
      } catch (e) {
        return { ok: false, message: errMessage(e, 'No se pudo cambiar la contraseña') };
      }
    },
    [authentication, user, clearLocalSession]
  );

  const requestPasswordReset = useCallback<AuthContextValue['requestPasswordReset']>(
    async (identifier) => {
      try {
        // Anti-enumeración: el módulo responde igual exista o no la cuenta.
        await authentication.requestPasswordReset(identifier.trim());
        return { ok: true, value: undefined };
      } catch (e) {
        return { ok: false, message: errMessage(e, 'No se pudo solicitar el reset') };
      }
    },
    [authentication]
  );

  const resetPassword = useCallback<AuthContextValue['resetPassword']>(
    async (token, newPassword) => {
      try {
        await authentication.resetPassword(token.trim(), newPassword);
        return { ok: true, value: undefined };
      } catch (e) {
        return { ok: false, message: errMessage(e, 'No se pudo restablecer la contraseña') };
      }
    },
    [authentication]
  );

  const getMfaStatus = useCallback<AuthContextValue['getMfaStatus']>(async () => {
    if (!user) return { ok: false, message: 'No hay sesión autenticada' };
    try {
      return { ok: true, value: await authentication.getMfaStatus(user.id) };
    } catch (e) {
      return { ok: false, message: errMessage(e, 'No se pudo leer el estado de MFA') };
    }
  }, [authentication, user]);

  const enrollMfa = useCallback<AuthContextValue['enrollMfa']>(async () => {
    if (!user) return { ok: false, message: 'No hay sesión autenticada' };
    try {
      return { ok: true, value: await authentication.enrollMfa(user.id) };
    } catch (e) {
      return { ok: false, message: errMessage(e, 'No se pudo iniciar el enrolamiento') };
    }
  }, [authentication, user]);

  const confirmMfa = useCallback<AuthContextValue['confirmMfa']>(
    async (code) => {
      if (!user) return { ok: false, message: 'No hay sesión autenticada' };
      try {
        return { ok: true, value: await authentication.confirmMfa(user.id, code.trim()) };
      } catch (e) {
        return { ok: false, message: errMessage(e, 'Código inválido') };
      }
    },
    [authentication, user]
  );

  const disableMfa = useCallback<AuthContextValue['disableMfa']>(
    async (code) => {
      if (!user) return { ok: false, message: 'No hay sesión autenticada' };
      try {
        await authentication.disableMfa(user.id, code.trim());
        return { ok: true, value: undefined };
      } catch (e) {
        return { ok: false, message: errMessage(e, 'No se pudo desactivar MFA') };
      }
    },
    [authentication, user]
  );

  const listSessions = useCallback<AuthContextValue['listSessions']>(async () => {
    if (!user) return [];
    return authentication.listSessions(user.id);
  }, [authentication, user]);

  const revokeSession = useCallback<AuthContextValue['revokeSession']>(
    async (targetSessionId) => {
      if (!user) return false;
      const revoked = await authentication.revokeSessionById(user.id, targetSessionId);
      if (revoked && targetSessionId === sessionId) {
        // Cerró su propia sesión desde "tus dispositivos" ⇒ logout local.
        clearLocalSession();
      }
      return revoked;
    },
    [authentication, user, sessionId, clearLocalSession]
  );

  const clearNotice = useCallback(() => setNotice(null), []);

  const actor: ActorContext | null =
    sessionToken && user ? { sessionToken, userId: user.id } : null;

  return (
    <AuthCtx.Provider
      value={{
        status,
        user,
        sessionToken,
        sessionId,
        actor,
        notice,
        clearNotice,
        register,
        login,
        completeMfa,
        requestVerification,
        confirmEmail,
        logout,
        changePassword,
        requestPasswordReset,
        resetPassword,
        getMfaStatus,
        enrollMfa,
        confirmMfa,
        disableMfa,
        listSessions,
        revokeSession,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthCtx);
  if (!context) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return context;
};
