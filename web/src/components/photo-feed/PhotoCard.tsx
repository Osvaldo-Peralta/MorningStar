import { useState } from 'react';

// web/src/components/PhotoCard.tsx
export const PhotoCard = ({ url, index }: { url: string; index: number }) => {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <div className="relative group break-inside-avoid rounded-[24px] overflow-hidden bg-zinc-900 border border-white/[0.05] transition-all duration-500 hover:border-white/[0.15] hover:shadow-[0_0_40px_-15px_rgba(255,255,255,0.1)]">
      {!isLoaded && (
        <div className="w-full aspect-square bg-zinc-900 animate-pulse" />
      )}
      <img 
        src={url} 
        onLoad={() => setIsLoaded(true)}
        className={`w-full object-cover transition-all duration-1000 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
      />
      {/* Etiqueta minimalista solo visible en hover */}
      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-md px-3 py-1 rounded-full border border-white/10">
         <span className="text-[10px] font-mono text-zinc-400">#{index + 1}</span>
      </div>
    </div>
  );
};