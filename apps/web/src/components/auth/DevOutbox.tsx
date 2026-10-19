// web/src/components/auth/DevOutbox.tsx
/*
--- Panel de desarrollo (solo environment=development): muestra los emails
--- "enviados" por InMemoryEmailDelivery y permite copiar sus tokens.
--- Con un proveedor real de email (backend), este panel no se renderiza.
*/
import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import type { SentEmail } from '@morningstar/core';

const TOKEN_REGEX = /token=([A-Za-z0-9_-]+)/;

export const DevOutbox: React.FC = () => {
  const { emailDelivery, environment } = useApp();
  const [emails, setEmails] = useState<SentEmail[]>([]);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (environment !== 'development') return;
    const sync = () => setEmails([...emailDelivery.outbox]);
    sync();
    // Suscripción reactiva: el panel se actualiza al instante con cada envío
    return emailDelivery.subscribe(sync);
  }, [emailDelivery, environment]);

  if (environment !== 'development') return null;

  const copyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token);
    } catch {
      /* clipboard puede no existir en jsdom; el token sigue visible */
    }
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="fixed bottom-4 left-4 z-200 max-w-sm" data-testid="dev-outbox">
      <button
        onClick={() => setOpen((v) => !v)}
        className="bg-zinc-800/90 text-zinc-300 text-xs px-4 py-2 rounded-full border border-white/10 hover:bg-zinc-700 transition-colors"
      >
        📮 Dev Outbox ({emails.length}) {open ? '▾' : '▸'}
      </button>

      {open && (
        <div className="mt-2 bg-zinc-900/95 border border-white/10 rounded-2xl p-4 space-y-3 max-h-64 overflow-y-auto">
          {emails.length === 0 && <p className="text-zinc-500 text-xs">Sin emails todavía.</p>}
          {emails.map((email) => {
            const token = email.body.match(TOKEN_REGEX)?.[1];
            return (
              <div key={email.messageId} className="border-b border-white/5 pb-2 last:border-0">
                <p className="text-xs text-zinc-400">
                  <span className="text-white">{email.to}</span> — {email.subject}
                </p>
                {token && (
                  <button
                    onClick={() => copyToken(token)}
                    className="mt-1 text-[10px] font-mono bg-white/5 hover:bg-white/10 text-emerald-300 px-2 py-1 rounded-lg transition-colors break-all"
                    title="Copiar token"
                  >
                    {copied === token ? '✓ copiado' : token}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
