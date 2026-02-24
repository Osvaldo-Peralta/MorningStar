import { useEffect, useState } from 'react';
import { ActionMenu } from '../ui/ActionMenu';
import type { ActionItem } from '../ui/ActionMenu';
import type { Photo } from '@modules/photo-feed/domain/Photo';

interface PhotoCardProps {
  photo: Photo;
  onDelete: () => void;
  onEdit: (photo: Photo) => void;
}

export const PhotoCard = ({ photo, onDelete, onEdit }: PhotoCardProps) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (isDeleting) {
      const timer = setTimeout(() => setIsDeleting(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [isDeleting]);

  useEffect(() => { setIsLoaded(false); }, [photo.url]);

  const handleInternalDelete = () => {
    setIsDeleting(true);
    onDelete();
  };

  const photoActions: ActionItem[] = [
    {
      label: 'Editar URL',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      ),
      onClick: () => onEdit(photo)
    },
    {
      label: 'Eliminar',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
      ),
      onClick: handleInternalDelete,
      variant: 'danger'
    }
  ];

  return (
    <div className={`
      animate-reveal relative group break-inside-avoid rounded-4xl overflow-hidden 
      bg-card border border-white/3 transition-all duration-500 var(--ease-premium)
      hover:border-white/10 hover:shadow-2xl hover:shadow-white/2
      ${isDeleting ? 'opacity-0 scale-90 blur-xl pointer-events-none' : 'opacity-100'}
    `}> 
      {!isLoaded && <div className="w-full aspect-square bg-zinc-900 animate-pulse" />} 
      <div className="absolute top-5 right-5 z-20 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0">
        <ActionMenu actions={photoActions} />
      </div>
      <img 
        src={photo.url} 
        alt={`Photo ${photo.id}`}
        onLoad={() => setIsLoaded(true)}
        className={`w-full h-auto object-cover transition-all duration-600 var(--ease-premium) ${isLoaded ? 'opacity-100 blur-0 scale-100' : 'opacity-0 blur-md scale-105'} group-hover:scale-110`}
      />
      <div className='absolute inset-0 bg-linear-to-b from-black/20 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none'></div>
    </div>
  );
};