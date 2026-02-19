import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { PhotoCard } from './photo-feed/PhotoCard';

export const PhotoFeed: React.FC = () => {
  const { photoFeed, events } = useApp();
  const [photos, setPhotos] = useState<string[]>([]);

  const refreshPhotos = () => {
    setPhotos(photoFeed.listPhotos());
  };

    useEffect(() => {
    refreshPhotos();
    
    // Ahora 'unsubscribe' es de tipo Unsubscribe (una función ejecutable)
    const unsubscribe = events.on('photo:added', refreshPhotos);
    
    // Al desmontar el componente, se ejecuta el off automáticamente
    return () => unsubscribe(); 
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

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-slate-200">
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
          {photos.map((url, index) => (
            <PhotoCard key={`${url}-${index}`} url={url} index={index} />
          ))}
        </div>

        {photos.length === 0 && (
          <div className="h-96 flex flex-col items-center justify-center border border-white/5 rounded-[2rem] bg-[#111]">
            <p className="text-zinc-600 font-medium tracking-widest text-sm uppercase">Empty Gallery</p>
          </div>
        )}
      </main>
    </div>
  );
};