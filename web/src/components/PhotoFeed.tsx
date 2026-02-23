// web/src/components/PhotoFeed.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { PhotoCard } from './photo-feed/PhotoCard';
import { Photo } from '@modules/photo-feed/domain/Photo';

export const PhotoFeed: React.FC = () => {
  const { photoFeed, events } = useApp();
  const [photos, setPhotos] = useState<Photo[]>([]); // Ahora guardamos objetos Photo

  const refreshPhotos = () => {
    setPhotos(photoFeed.listEntries());
  };

    useEffect(() => {
    refreshPhotos();
    const subAdd = events.on('photo:added', refreshPhotos);
    const subEdit = events.on('photo:edited', refreshPhotos); // Este evento no ha sido implementado jamas en el frontend
    const subRemove = events.on('photo:removed', refreshPhotos);
    
    return () => {
      subAdd();
      subEdit()
      subRemove();
    }
    }, [photoFeed, events]);

  const handleAddPhoto = async () => {
    const url = prompt('URL de la imagen (debe empezar con http):');
    if (url) {
      try {
        await photoFeed.addPhoto(url);
      } catch (e: any) {
        alert(e.message);
      }
    }
  };

  const handleEdit = useCallback(async (photo: Photo) => {
    const newUrl = prompt('Nueva URL de la imagen: ', photo.url);

    if(newUrl && newUrl !== photo.url) {
      try {
        // Llamada al metodo del modulo backend
        await photoFeed.editPhoto(photo.id, {url: newUrl});
      } catch (e: any) {
        alert(e.message)
      }
    }
  }, [photoFeed]);    // Solo se recrea si el moudulo cambia

  const handleDelete = useCallback(async (id: string) => {
    if (confirm('¿Seguro que quieres eliminar esta foto?')) {
      await photoFeed.removePhoto(id);
    }
  }, [photoFeed])

  return (
    <div className="min-h-screen bg-background text-slate-200">
      <header className="max-w-6xl mx-auto px-8 pt-16 pb-12 flex justify-between items-end">
        <div>
          <h1 className="text-5xl font-extrabold tracking-tighter text-white">MorningStar</h1>
          <p className="text-slate-500 mt-2 font-light italic">Digital Archive v{photoFeed.version}</p>
        </div>
        <button 
          onClick={handleAddPhoto}
          className="bg-white text-black text-sm font-bold px-8 py-3 rounded-full hover:bg-slate-200 transition-all active:scale-95"
        >
          UPLOAD
        </button>
      </header>

      <main className="max-w-6xl mx-auto px-8 pb-20">
        <div className="columns-1 sm:columns-2 lg:columns-3 gap-8 space-y-8">
          {photos.map((photo) => (
            <PhotoCard
              key={photo.id}      // Se mantiene para el algoritmo de reconciliación de React
              photo={photo}       // Pasamos la entidad completa (aquí van url e id)
              onDelete={() => handleDelete(photo.id)}
              onEdit={handleEdit} // Referencia estable gracias al useCallback
            />
          ))}
        </div>

        {photos.length === 0 && (
          <div className="h-96 flex flex-col items-center justify-center border border-white/5 rounded-4xl bg-[#111]">
            <p className="text-zinc-600 font-medium tracking-widest text-sm uppercase">Empty Gallery</p>
          </div>
        )}
      </main>
    </div>
  );
};