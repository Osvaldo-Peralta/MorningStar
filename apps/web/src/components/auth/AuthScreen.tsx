// web/src/components/auth/AuthScreen.tsx
/*
--- Máquina de estados de autenticación: login | register | mfa | pending
--- | forgot | reset (8b: reset de contraseña self-service por email).
--- Errores inline (nunca alert), estilo glass consistente con los modales.
*/
import React, { useEffect, useState } from 'react';
import { useAuth, type AuthOutcome } from '../../context/AuthContext';
import {
  inputClass,
  primaryButtonClass,
  linkButtonClass,
  ErrorNote,
  InfoNote,
} from './notes';

type Mode = 'login' | 'register' | 'mfa' | 'pending' | 'forgot' | 'reset';

export const AuthScreen: React.FC = () => {
  const {
    login,
    register,
    completeMfa,
    confirmEmail,
    notice,
    clearNotice,
    requestPasswordReset,
    resetPassword,
  } = useAuth();

  const [mode, setMode] = useState<Mode>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Campos
  const [identifier, setIdentifier] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');

  // Avisos transitorios del contexto (p. ej. "Contraseña cambiada…", 8b):
  // se muestran una vez en el modo login y se consumen.
  useEffect(() => {
    if (notice) {
      setInfo(notice);
      setError(null);
      clearNotice();
    }
  }, [notice, clearNotice]);

  const handleOutcome = (outcome: AuthOutcome): boolean => {
    setBusy(false);
    switch (outcome.kind) {
      case 'ok':
        setPassword(''); // higiene: no dejar la contraseña en el estado
        setPasswordConfirm('');
        return true; // el AuthGate cambia de pantalla solo
      case 'mfa-required':
        setMfaToken(outcome.mfaToken);
        setMfaCode('');
        setPassword('');
        setPasswordConfirm('');
        setMode('mfa');
        return true;
      case 'pending-verification':
        setPassword(''); // la contraseña del registro no debe filtrarse al login
        setPasswordConfirm('');
        setMode('pending');
        setInfo('Te enviamos un email de verificación (en dev: mira el Dev Outbox).');
        return true;
      case 'error':
        setError(outcome.message);
        return false;
    }
  };

  const submitLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    handleOutcome(await login(identifier.trim(), password));
  };

  const submitRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== passwordConfirm) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setBusy(true);
    handleOutcome(
      await register(
        { username: username.trim(), email: email.trim(), displayName: displayName.trim() },
        password
      )
    );
  };

  const submitMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    handleOutcome(await completeMfa(mfaToken, mfaCode.trim()));
  };

  const submitVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const outcome = await confirmEmail(verificationToken.trim());
    setBusy(false);
    if (outcome.kind === 'ok') {
      setMode('login');
      setInfo('¡Cuenta verificada! Ya puedes iniciar sesión.');
      setVerificationToken('');
    } else if (outcome.kind === 'error') {
      setError(outcome.message);
    }
  };

  const submitForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await requestPasswordReset(identifier.trim());
    setBusy(false);
    if (result.ok) {
      // Anti-enumeración: el mismo mensaje exista o no la cuenta.
      setMode('reset');
      setResetToken('');
      setNewPassword('');
      setNewPasswordConfirm('');
      setInfo(
        'Si la cuenta existe, enviamos un email con instrucciones (en dev: mira el Dev Outbox).'
      );
    } else {
      setError(result.message);
    }
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== newPasswordConfirm) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setBusy(true);
    const result = await resetPassword(resetToken.trim(), newPassword);
    setBusy(false);
    if (result.ok) {
      // resetPassword revoca todas las sesiones del usuario (ADR-0009)
      setResetToken('');
      setNewPassword('');
      setNewPasswordConfirm('');
      setMode('login');
      setInfo('Contraseña actualizada. Inicia sesión con tu nueva contraseña.');
    } else {
      setError(result.message);
    }
  };

  const backToLogin = (label = 'Volver al inicio de sesión') => (
    <button
      type="button"
      onClick={() => { setMode('login'); setError(null); }}
      className={linkButtonClass}
    >
      {label}
    </button>
  );

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white/3 backdrop-blur-3xl rounded-[2.5rem] p-10 border border-white/10 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
        <h1 className="text-3xl font-extrabold tracking-tighter text-white text-center">MorningStar</h1>
        <p className="text-zinc-500 text-center text-sm mt-1 mb-8 italic">Digital Archive</p>

        {(mode === 'login' || mode === 'register') && (
          <div className="flex bg-white/5 rounded-full p-1 mb-8" role="tablist" aria-label="Modo de acceso">
            <button
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => { setMode('login'); setError(null); setPassword(''); setPasswordConfirm(''); }}
              className={`flex-1 px-4 py-2 rounded-full text-sm transition-all ${mode === 'login' ? 'bg-white text-black font-bold' : 'text-zinc-400 hover:text-white'}`}
            >
              Iniciar sesión
            </button>
            <button
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => { setMode('register'); setError(null); setPassword(''); setPasswordConfirm(''); }}
              className={`flex-1 px-4 py-2 rounded-full text-sm transition-all ${mode === 'register' ? 'bg-white text-black font-bold' : 'text-zinc-400 hover:text-white'}`}
            >
              Crear cuenta
            </button>
          </div>
        )}

        <InfoNote message={mode === 'login' ? info : null} />

        {mode === 'login' && (
          <form onSubmit={submitLogin} className="space-y-4" aria-label="Formulario de inicio de sesión">
            <input className={inputClass} placeholder="Usuario o email" value={identifier}
              onChange={(e) => setIdentifier(e.target.value)} autoFocus required />
            <input className={inputClass} type="password" placeholder="Contraseña" value={password}
              onChange={(e) => setPassword(e.target.value)} required />
            <ErrorNote message={error} />
            <button type="submit" className={primaryButtonClass} disabled={busy || !identifier.trim() || !password}>
              {busy ? 'ENTRANDO…' : 'ENTRAR'}
            </button>
            <button
              type="button"
              onClick={() => { setMode('forgot'); setError(null); setInfo(null); }}
              className={linkButtonClass}
            >
              ¿Olvidaste tu contraseña?
            </button>
          </form>
        )}

        {mode === 'register' && (
          <form onSubmit={submitRegister} className="space-y-4" aria-label="Formulario de registro">
            <input className={inputClass} placeholder="Usuario (a-z, 0-9, 3-32)" value={username}
              onChange={(e) => setUsername(e.target.value)} autoFocus required />
            <input className={inputClass} type="email" placeholder="Email" value={email}
              onChange={(e) => setEmail(e.target.value)} required />
            <input className={inputClass} placeholder="Nombre visible" value={displayName}
              onChange={(e) => setDisplayName(e.target.value)} required />
            <input className={inputClass} type="password" placeholder="Contraseña (mín. 8)" value={password}
              onChange={(e) => setPassword(e.target.value)} required />
            <input className={inputClass} type="password" placeholder="Repite la contraseña" value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)} required />
            <ErrorNote message={error} />
            <button type="submit" className={primaryButtonClass} disabled={busy}>
              {busy ? 'CREANDO…' : 'CREAR CUENTA'}
            </button>
          </form>
        )}

        {mode === 'mfa' && (
          <form onSubmit={submitMfa} className="space-y-4" aria-label="Verificación en dos pasos">
            <p className="text-zinc-400 text-sm px-2">
              Tu cuenta tiene verificación en dos pasos. Introduce el código de tu app de
              autenticación o un código de respaldo.
            </p>
            <input className={inputClass} placeholder="Código (6 dígitos o backup)" value={mfaCode}
              onChange={(e) => setMfaCode(e.target.value)} autoFocus inputMode="text" autoComplete="one-time-code" required />
            <ErrorNote message={error} />
            <button type="submit" className={primaryButtonClass} disabled={busy || !mfaCode.trim()}>
              {busy ? 'VERIFICANDO…' : 'VERIFICAR'}
            </button>
            <button type="button" onClick={() => { setMode('login'); setError(null); }}
              className={linkButtonClass}>
              Volver
            </button>
          </form>
        )}

        {mode === 'pending' && (
          <form onSubmit={submitVerification} className="space-y-4" aria-label="Verificación de email">
            <p className="text-zinc-400 text-sm px-2">
              Tu cuenta está creada pero pendiente de verificación. Pega el token del email
              que te enviamos (en desarrollo: cópialo del <span className="text-white">Dev Outbox</span>).
            </p>
            <InfoNote message={info} />
            <input className={inputClass} placeholder="Token de verificación" value={verificationToken}
              onChange={(e) => setVerificationToken(e.target.value)} autoFocus required />
            <ErrorNote message={error} />
            <button type="submit" className={primaryButtonClass} disabled={busy || !verificationToken.trim()}>
              {busy ? 'VERIFICANDO…' : 'VERIFICAR CUENTA'}
            </button>
            {backToLogin()}
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={submitForgot} className="space-y-4" aria-label="Restablecer contraseña">
            <p className="text-zinc-400 text-sm px-2">
              Te enviaremos un email con un enlace de restablecimiento (un solo uso, expira en
              1 hora). En desarrollo, el token aparece en el <span className="text-white">Dev Outbox</span>.
            </p>
            <input className={inputClass} placeholder="Usuario o email" value={identifier}
              onChange={(e) => setIdentifier(e.target.value)} autoFocus required />
            <ErrorNote message={error} />
            <button type="submit" className={primaryButtonClass} disabled={busy || !identifier.trim()}>
              {busy ? 'ENVIANDO…' : 'ENVIAR INSTRUCCIONES'}
            </button>
            {backToLogin()}
          </form>
        )}

        {mode === 'reset' && (
          <form onSubmit={submitReset} className="space-y-4" aria-label="Nueva contraseña">
            <p className="text-zinc-400 text-sm px-2">
              Pega el token del email (en dev: cópialo del <span className="text-white">Dev Outbox</span>)
              y elige tu nueva contraseña. Se cerrarán las sesiones de todos tus dispositivos.
            </p>
            <InfoNote message={info} />
            <input className={inputClass} placeholder="Token de reset" value={resetToken}
              onChange={(e) => setResetToken(e.target.value)} autoFocus required />
            <input className={inputClass} type="password" placeholder="Nueva contraseña (mín. 8)" value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required />
            <input className={inputClass} type="password" placeholder="Repite la nueva contraseña" value={newPasswordConfirm}
              onChange={(e) => setNewPasswordConfirm(e.target.value)} autoComplete="new-password" required />
            <ErrorNote message={error} />
            <button type="submit" className={primaryButtonClass}
              disabled={busy || !resetToken.trim() || !newPassword || !newPasswordConfirm}>
              {busy ? 'RESTABLECIENDO…' : 'RESTABLECER CONTRASEÑA'}
            </button>
            {backToLogin()}
          </form>
        )}
      </div>
    </div>
  );
};
