// web/src/context/AuthContext.tsx
/*
--- Estado de sesión del navegador (ADR-0013).
--- Patrón SPA sin backend HTTP: el refresh token vive en localStorage
--- (deuda documentada: httpOnly cookies cuando exista backend).
*/
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useApp, webDeviceFingerprint } from './AppContext';
import { MfaRequiredError, AccountNotActiveError } from '@morningstar/authentication';
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

interface AuthContextValue {
  status: AuthStatus;
  user: UserSnapshot | null;
  sessionToken: string | null;
  /** ActorContext para los comandos de dominio (fail-closed, ADR-0012). */
  actor: ActorContext | null;
  register(input: { username: string; email: string; displayName: string }, password: string): Promise<AuthOutcome>;
  login(identifier: string, password: string): Promise<AuthOutcome>;
  completeMfa(mfaToken: string, code: string): Promise<AuthOutcome>;
  requestVerification(identifier: string): Promise<AuthOutcome>;
  confirmEmail(token: string): Promise<AuthOutcome>;
  logout(): Promise<void>;
}

const AuthCtx = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { identity, authentication } = useApp();
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<UserSnapshot | null>(null);
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  const adoptSession = useCallback(
    async (result: { userId: string; session: { token: string }; refreshToken: string }) => {
      localStorage.setItem(RT_STORAGE_KEY, result.refreshToken);
      setSessionToken(result.session.token);
      setUser(await identity.getUser(result.userId));
      setStatus('authenticated');
    },
    [identity]
  );

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
        return { kind: 'error', message: e instanceof Error ? e.message : 'Error en el registro' };
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
        return { kind: 'error', message: e instanceof Error ? e.message : 'Error en el login' };
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
        return { kind: 'error', message: e instanceof Error ? e.message : 'Código inválido' };
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
        return { kind: 'error', message: e instanceof Error ? e.message : 'Error al solicitar verificación' };
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
        return { kind: 'error', message: e instanceof Error ? e.message : 'Token inválido' };
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
    localStorage.removeItem(RT_STORAGE_KEY);
    setSessionToken(null);
    setUser(null);
    setStatus('anonymous');
  }, [authentication, sessionToken]);

  const actor: ActorContext | null =
    sessionToken && user ? { sessionToken, userId: user.id } : null;

  return (
    <AuthCtx.Provider
      value={{
        status,
        user,
        sessionToken,
        actor,
        register,
        login,
        completeMfa,
        requestVerification,
        confirmEmail,
        logout,
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
