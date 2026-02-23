// web/src/components/photo-feed/PhotoCard.tsx
import { useState } from 'react';
import { ActionMenu } from '../ui/ActionMenu';
import type { ActionItem } from '../ui/ActionMenu';
import type { Photo } from '@modules/photo-feed/domain/Photo';

interface PhotoCardProps {
  photo: Photo                       // Se pasa toda la entidad completa
  onDelete: () => void;              // Nueva prop
  onEdit: (photo: Photo) => void;    // el callback ahora devuelve el contexto completo
}

export const PhotoCard = ({ photo, onDelete, onEdit }: PhotoCardProps) => {
  const [isLoaded, setIsLoaded] = useState(false);

  // Se definen las acciones que alimentaran al ActionMenu
  const photoActions: ActionItem[] = [
    {
      label: 'Editar URL',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      ),
      onClick: () => onEdit(photo) // paso el objeto a invocar
    },
    {
      label: 'Eliminar',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      ),
      onClick: onDelete,
      variant: 'danger'
    }
  ];

  return (
    <div className="relative group break-inside-avoid rounded-3xl overflow-hidden bg-zinc-900 border border-white/5 transition-all duration-500 hover:border-white/15 hover:shadow-[0_0_40px_-15px_rgba(255,255,255,0.1)]">
      { /* Skeleton Loader */ }
      {!isLoaded && (
        <div className="w-full aspect-square bg-zinc-900 animate-pulse" />
      )}
      {/* Nuevo ActionMenu personalizable */}
      <div className="absolute top-4 right-4 z-20 opacity-0 group-hover:opacity-100 transition-opacity">
        <ActionMenu actions={photoActions} />
      </div>

      <img 
        src={photo.url} 
        alt={`Photo ${photo.id}`}
        onLoad={() => setIsLoaded(true)}
        className={`w-full object-cover transition-all duration-1000 ${isLoaded ? 'opacity-100 scale-100' : 'opacity-0 scale-110'}`}
      />
    </div>
  );
};