// web/src/components/auth/notes.tsx
/*
--- Piezas de UI compartidas por AuthScreen y SecurityModal (8b):
--- clases de inputs/botones del estilo "cristal líquido" y notas
--- error/info accesibles (role=alert / role=status).
*/
import React from 'react';

export const inputClass =
  'w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white focus:outline-none focus:ring-2 focus:ring-white/10 transition-all placeholder:text-zinc-500';

export const primaryButtonClass =
  'w-full px-6 py-4 bg-white text-black font-bold rounded-full hover:scale-[1.01] active:scale-95 transition-all disabled:bg-zinc-800 disabled:text-zinc-500 disabled:hover:scale-100';

export const secondaryButtonClass =
  'w-full px-6 py-3 bg-white/5 border border-white/10 text-white text-sm font-semibold rounded-full hover:bg-white/10 active:scale-95 transition-all disabled:opacity-40 disabled:hover:bg-white/5';

export const linkButtonClass =
  'w-full text-zinc-500 text-sm hover:text-white transition-colors';

export const ErrorNote: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <p className="text-sm text-red-400 px-2" role="alert">
      {message}
    </p>
  ) : null;

export const InfoNote: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <p className="text-sm text-emerald-300 px-2" role="status">
      {message}
    </p>
  ) : null;
