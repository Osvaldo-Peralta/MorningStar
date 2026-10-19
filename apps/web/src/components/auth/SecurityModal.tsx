// web/src/components/auth/SecurityModal.tsx
/*
--- Gestión de cuenta (Iteración 8b, ADR-0014):
---   1. Verificación en dos pasos: enrolamiento MFA con QR (qrcode.react,
---      URI otpauth:// de TotpService) + secret manual de respaldo,
---      backup codes con copia/descarga (entrega única) y desactivación.
---   2. Contraseña: cambio con contraseña actual (el backend revoca todas
---      las sesiones ⇒ la app vuelve al AuthScreen con aviso).
---   3. Dispositivos: listSessions + revocación por dispositivo
---      (revokeSessionById) y "cerrar las demás sesiones".
--- Modal de cristal líquido reutilizado (ui/Modal); secciones internas sin
--- router (decisión de 8b votada: modal desde PhotoFeed).
*/
import React, { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Modal } from '../ui/Modal';
import { useAuth } from '../../context/AuthContext';
import {
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
  ErrorNote,
  InfoNote,
} from './notes';
import type { MfaEnrollment, MfaStatus, SessionInfo } from '@morningstar/authentication';

type Section = 'mfa' | 'password' | 'devices';

const tabClass = (active: boolean) =>
  `flex-1 px-3 py-2 rounded-full text-xs transition-all ${
    active ? 'bg-white text-black font-bold' : 'text-zinc-400 hover:text-white'
  }`;

const formatDate = (ts: number): string => new Date(ts).toLocaleString();

/** Descarga los backup codes como .txt (una sola entrega: en reposo solo hay hashes). */
const downloadBackupCodes = (codes: readonly string[]): void => {
  const blob = new Blob([codes.join('\n') + '\n'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'morningstar-backup-codes.txt';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
};

export const SecurityModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const {
    sessionId,
    getMfaStatus,
    enrollMfa,
    confirmMfa,
    disableMfa,
    changePassword,
    listSessions,
    revokeSession,
  } = useAuth();

  const [section, setSection] = useState<Section>('mfa');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // ── MFA ────────────────────────────────────────────────────────────────
  const [mfaStatus, setMfaStatus] = useState<MfaStatus | null>(null);
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<readonly string[] | null>(null);
  const [disableCode, setDisableCode] = useState('');

  // ── Contraseña ─────────────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');

  // ── Dispositivos ───────────────────────────────────────────────────────
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);

  const refreshMfaStatus = useCallback(async () => {
    const result = await getMfaStatus();
    if (result.ok) setMfaStatus(result.value);
    return result;
  }, [getMfaStatus]);

  const refreshSessions = useCallback(async () => {
    setSessions(await listSessions());
  }, [listSessions]);

  // Al abrir: resetear el estado interno y cargar la sección inicial.
  useEffect(() => {
    if (!isOpen) return;
    setSection('mfa');
    setBusy(false);
    setError(null);
    setInfo(null);
    setEnrollment(null);
    setMfaCode('');
    setBackupCodes(null);
    setDisableCode('');
    setCurrentPassword('');
    setNewPassword('');
    setNewPasswordConfirm('');
    setSessions(null);
    void refreshMfaStatus();
  }, [isOpen, refreshMfaStatus]);

  // La lista de dispositivos se carga al entrar en la sección.
  useEffect(() => {
    if (isOpen && section === 'devices' && sessions === null) void refreshSessions();
  }, [isOpen, section, sessions, refreshSessions]);

  const copyText = async (text: string, okMessage: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setInfo(okMessage);
    } catch {
      setInfo('No se pudo copiar al portapapeles (selecciona el texto manualmente).');
    }
  };

  // ── Handlers MFA ───────────────────────────────────────────────────────
  const startEnrollment = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    const result = await enrollMfa();
    setBusy(false);
    if (result.ok) {
      setEnrollment(result.value);
      setMfaCode('');
    } else {
      setError(result.message);
    }
  };

  const submitConfirmMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await confirmMfa(mfaCode);
    setBusy(false);
    if (result.ok) {
      setBackupCodes(result.value.backupCodes); // entrega única
      setEnrollment(null);
      setMfaCode('');
      void refreshMfaStatus();
    } else {
      setError(result.message);
    }
  };

  const submitDisableMfa = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result = await disableMfa(disableCode);
    setBusy(false);
    if (result.ok) {
      setDisableCode('');
      setInfo('Verificación en dos pasos desactivada.');
      void refreshMfaStatus();
    } else {
      setError(result.message);
    }
  };

  // ── Handler contraseña ─────────────────────────────────────────────────
  const submitChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword !== newPasswordConfirm) {
      setError('Las contraseñas no coinciden');
      return;
    }
    setBusy(true);
    const result = await changePassword(currentPassword, newPassword);
    setBusy(false);
    if (result.ok) {
      // El backend revocó todas las sesiones: el AuthGate vuelve al
      // AuthScreen con el aviso del contexto (este modal se desmonta).
      return;
    }
    setError(result.message);
  };

  // ── Handlers dispositivos ──────────────────────────────────────────────
  const closeSession = async (targetSessionId: string) => {
    setError(null);
    await revokeSession(targetSessionId);
    await refreshSessions();
  };

  const closeOtherSessions = async () => {
    setError(null);
    setBusy(true);
    const others = (sessions ?? []).filter((s) => s.sessionId !== sessionId);
    for (const other of others) await revokeSession(other.sessionId);
    setBusy(false);
    await refreshSessions();
  };

  const othersCount = (sessions ?? []).filter((s) => s.sessionId !== sessionId).length;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Seguridad">
      <div className="flex bg-white/5 rounded-full p-1 mb-6" role="tablist" aria-label="Secciones de seguridad">
        <button role="tab" aria-selected={section === 'mfa'} className={tabClass(section === 'mfa')}
          onClick={() => { setSection('mfa'); setError(null); setInfo(null); }}>
          Dos pasos
        </button>
        <button role="tab" aria-selected={section === 'password'} className={tabClass(section === 'password')}
          onClick={() => { setSection('password'); setError(null); setInfo(null); }}>
          Contraseña
        </button>
        <button role="tab" aria-selected={section === 'devices'} className={tabClass(section === 'devices')}
          onClick={() => { setSection('devices'); setError(null); setInfo(null); }}>
          Dispositivos
        </button>
      </div>

      <InfoNote message={info} />
      <ErrorNote message={error} />

      {section === 'mfa' && (
        <div className="space-y-4" aria-label="Verificación en dos pasos">
          {backupCodes && (
            <div className="space-y-3" data-testid="backup-codes">
              <p className="text-sm text-amber-300 px-2">
                Guarda estos códigos: se muestran <span className="font-bold">una sola vez</span>.
                Cada uno permite un inicio de sesión sin tu app de autenticación.
              </p>
              <ul className="grid grid-cols-2 gap-2">
                {backupCodes.map((code) => (
                  <li key={code} data-testid="backup-code"
                    className="font-mono text-xs bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-emerald-300 text-center">
                    {code}
                  </li>
                ))}
              </ul>
              <button type="button" className={secondaryButtonClass}
                onClick={() => void copyText(backupCodes.join('\n'), 'Códigos copiados al portapapeles.')}>
                Copiar
              </button>
              <button type="button" className={secondaryButtonClass}
                onClick={() => downloadBackupCodes(backupCodes)}>
                Descargar .txt
              </button>
              <button type="button" className={primaryButtonClass}
                onClick={() => setBackupCodes(null)}>
                LISTO
              </button>
            </div>
          )}

          {!backupCodes && enrollment && (
            <form onSubmit={submitConfirmMfa} className="space-y-4" aria-label="Enrolamiento MFA">
              <p className="text-zinc-400 text-sm px-2">
                Escanea el QR con tu app de autenticación (o introduce el secret manualmente)
                y confirma con un código de 6 dígitos.
              </p>
              <div className="flex justify-center" data-testid="mfa-qr" role="img"
                aria-label="Código QR de enrolamiento de dos pasos">
                <div className="bg-white p-3 rounded-2xl">
                  <QRCodeSVG value={enrollment.otpauthUri} size={160} fgColor="#111111" bgColor="#ffffff" marginSize={1} />
                </div>
              </div>
              <div className="text-center space-y-1">
                <p className="text-zinc-500 text-xs">¿No puedes escanear? Secret manual:</p>
                <code data-testid="mfa-secret"
                  className="block font-mono text-xs text-white bg-white/5 border border-white/10 rounded-lg px-3 py-2 break-all select-all">
                  {enrollment.secret}
                </code>
              </div>
              <input className={inputClass} placeholder="Código de tu app (6 dígitos)" value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" required />
              <button type="submit" className={primaryButtonClass} disabled={busy || !mfaCode.trim()}>
                {busy ? 'CONFIRMANDO…' : 'CONFIRMAR Y ACTIVAR'}
              </button>
              <button type="button" className="w-full text-zinc-500 text-sm hover:text-white transition-colors"
                onClick={() => { setEnrollment(null); setMfaCode(''); }}>
                Cancelar
              </button>
            </form>
          )}

          {!backupCodes && !enrollment && mfaStatus && !mfaStatus.active && (
            <div className="space-y-4">
              <p className="text-zinc-400 text-sm px-2">
                Protege tu cuenta con un segundo factor: códigos de 6 dígitos generados por tu
                app de autenticación (TOTP) + códigos de respaldo.
              </p>
              <button type="button" className={primaryButtonClass} disabled={busy}
                onClick={() => void startEnrollment()}>
                {busy ? 'PREPARANDO…' : 'ACTIVAR VERIFICACIÓN EN DOS PASOS'}
              </button>
            </div>
          )}

          {!backupCodes && !enrollment && mfaStatus?.active && (
            <form onSubmit={submitDisableMfa} className="space-y-4">
              <p className="text-sm text-emerald-300 px-2" data-testid="mfa-active">
                ✓ La verificación en dos pasos está activa.
              </p>
              <input className={inputClass} placeholder="Código actual (TOTP o backup)" value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)} autoComplete="one-time-code" required />
              <button type="submit" className={secondaryButtonClass} disabled={busy || !disableCode.trim()}>
                {busy ? 'DESACTIVANDO…' : 'Desactivar verificación en dos pasos'}
              </button>
            </form>
          )}
        </div>
      )}

      {section === 'password' && (
        <form onSubmit={submitChangePassword} className="space-y-4" aria-label="Cambio de contraseña">
          <p className="text-zinc-400 text-sm px-2">
            Al cambiar la contraseña se cerrarán las sesiones de todos tus dispositivos.
          </p>
          <input className={inputClass} type="password" placeholder="Contraseña actual" value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
          <input className={inputClass} type="password" placeholder="Nueva contraseña (mín. 8)" value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required />
          <input className={inputClass} type="password" placeholder="Repite la nueva contraseña" value={newPasswordConfirm}
            onChange={(e) => setNewPasswordConfirm(e.target.value)} autoComplete="new-password" required />
          <button type="submit"
            className={primaryButtonClass}
            disabled={busy || !currentPassword || !newPassword || !newPasswordConfirm}>
            {busy ? 'CAMBIANDO…' : 'CAMBIAR CONTRASEÑA'}
          </button>
        </form>
      )}

      {section === 'devices' && (
        <div className="space-y-4" aria-label="Tus dispositivos">
          {sessions === null && <p className="text-zinc-500 text-sm px-2 animate-pulse">Cargando sesiones…</p>}
          {sessions !== null && sessions.length === 0 && (
            <p className="text-zinc-500 text-sm px-2">No hay sesiones activas.</p>
          )}
          <ul className="space-y-3">
            {(sessions ?? []).map((s) => {
              const isCurrent = s.sessionId === sessionId;
              return (
                <li key={s.sessionId} data-testid="session-item"
                  className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-xs text-white truncate" title={s.deviceFingerprint}>
                      {s.deviceFingerprint.slice(0, 12)}…
                    </span>
                    {isCurrent && (
                      <span data-testid="current-device-badge"
                        className="shrink-0 text-[10px] bg-emerald-400/10 text-emerald-300 border border-emerald-400/20 px-2 py-0.5 rounded-full">
                        Este dispositivo
                      </span>
                    )}
                  </div>
                  <p className="text-zinc-500 text-[11px]">Creada: {formatDate(s.issuedAt)}</p>
                  <p className="text-zinc-500 text-[11px]">Última actividad: {formatDate(s.lastSeenAt)}</p>
                  {!isCurrent && (
                    <button type="button"
                      className="mt-1 text-xs text-red-300 hover:text-red-200 bg-white/5 hover:bg-white/10 border border-white/10 px-3 py-1.5 rounded-full transition-colors"
                      onClick={() => void closeSession(s.sessionId)}>
                      Cerrar
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {othersCount > 0 && (
            <button type="button" className={secondaryButtonClass} disabled={busy}
              onClick={() => void closeOtherSessions()}>
              {busy ? 'CERRANDO…' : `Cerrar las demás sesiones (${othersCount})`}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
};
