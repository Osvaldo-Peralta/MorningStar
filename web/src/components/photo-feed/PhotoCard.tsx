import { useState } from 'react';

interface PhotoCardProps {
  url: string;
  index: string;
  onDelete: () => void; // Nueva prop
}

export const PhotoCard = ({ url, index, onDelete }: PhotoCardProps) => {
  const [isLoaded, setIsLoaded] = useState(false);

  return (
    <div className="relative group break-inside-avoid rounded-3xl overflow-hidden bg-zinc-900 border border-white/5 transition-all duration-500 hover:border-white/15 hover:shadow-[0_0_40px_-15px_rgba(255,255,255,0.1)]">
      {!isLoaded && (
        <div className="w-full aspect-square bg-zinc-900 animate-pulse" />
      )}
      {/* Botón Eliminar - Solo visible en Hover */}
      <button 
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="absolute top-4 right-4 z-10 opacity-0 group-hover:opacity-100 transition-opacity bg-red-500/20 hover:bg-red-500 backdrop-blur-md text-white p-2 rounded-full border border-red-500/50"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      <img 
        src={url} 
        onLoad={() => setIsLoaded(true)}
        className={`w-full object-cover transition-all duration-1000 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
};