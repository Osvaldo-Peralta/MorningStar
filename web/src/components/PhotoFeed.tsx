// web/src/components/PhotoFeed.tsx
import React, { useEffect, useState, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import { PhotoCard } from './photo-feed/PhotoCard';
import { Photo } from '@modules/photo-feed/domain/Photo';
import { Modal } from './ui/Modal';

export const PhotoFeed: React.FC = () => {
  const { photoFeed, events } = useApp();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [isAdding, setIsAdding] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [photoToDelete, setPhotoToDelete] = useState<Photo | null>(null);
  const [photoToEdit, setPhotoToEdit] = useState<Photo | null>(null);
  const [tempUrl, setTempUrl] = useState('');

  const refreshPhotos = useCallback(() => { setPhotos(photoFeed.listEntries()); }, [photoFeed]);

  useEffect(() => {
    refreshPhotos();
    const subs = [
      events.on('photo:added', refreshPhotos),
      events.on('photo:edited', refreshPhotos),
      events.on('photo:removed', refreshPhotos)
    ];
    return () => subs.forEach(unsub => unsub());
  }, [photoFeed, events, refreshPhotos]);

  const handleConfirmAdd = async () => {
    if(newUrl.trim()) {
      try { await photoFeed.addPhoto(newUrl); setNewUrl(''); setIsAdding(false); } 
      catch (e: any) { alert(e.message); }
    }
  };

  const confirmEdit = async () => {
    if(photoToEdit && tempUrl && tempUrl !== photoToEdit.url) {
      try { await photoFeed.editPhoto(photoToEdit.id, {url: tempUrl}); setPhotoToEdit(null); } 
      catch (e: any) { alert(e.message); }
    }
  }, [photoFeed]);    // Solo se recrea si el moudulo cambia

  const confirmDelete = async () => {
    if(photoToDelete) { await photoFeed.removePhoto(photoToDelete.id); setPhotoToDelete(null); }
  };

  return (
    <div className="min-h-screen bg-background text-slate-200">
      <header className="max-w-6xl mx-auto px-8 pt-16 pb-12 flex justify-between items-end">
        <div>
          <h1 className="text-5xl font-extrabold tracking-tighter text-white">MorningStar</h1>
          <p className="text-slate-500 mt-2 font-light italic">Digital Archive v{photoFeed.version}</p>
        </div>
        <button onClick={() => setIsAdding(true)} className="bg-white text-black text-sm font-bold px-8 py-3 rounded-full hover:bg-slate-200 active:scale-95 active:animate-button-press transition-all duration-300 hover:shadow-[0_8px_30px_rgb(255,255,255,0.12)]">UPLOAD</button>
      </header>

      <main className="max-w-6xl mx-auto px-8 pb-20">
        <div className="columns-1 sm:columns-2 lg:columns-3 gap-8 space-y-8">
          {photos.map(p => (
            <PhotoCard key={p.id} photo={p} onDelete={() => setPhotoToDelete(p)} onEdit={(p) => { setPhotoToEdit(p); setTempUrl(p.url); }} />
          ))}
        </div>
      </main>

      {/* Modal: Add */}
      <Modal isOpen={isAdding} title="Nueva Fotografía" onClose={() => setIsAdding(false)}>
        <div className="space-y-6">
          <input autoFocus type="text" value={newUrl} onChange={e => setNewUrl(e.target.value)} className="w-full bg-white/30 border border-white/30 rounded-2xl px-5 py-4 text-white focus:outline-none focus:border-white/20 transition-all placeholder:text-zinc-500" placeholder="Enlace de la imagen..." />
          <div className='flex gap-4'>
            <button onClick={() => setIsAdding(false)} className="flex-1 px-6 py-4 rounded-full bg-white/5 text-white hover:bg-white/10 transition-colors">Cancelar</button>
            <button onClick={handleConfirmAdd} className="flex-1 px-6 bg-white text-green-500 font-bold py-4 rounded-3xl hover:bg-green-500/60 hover:text-white transition-colors">AÑADIR</button>
          </div>
        </div>
      </Modal>

      {/* Modal: Delete */}
      <Modal isOpen={!!photoToDelete} title="¿Eliminar del archivo?" onClose={() => setPhotoToDelete(null)}>
        <p className="text-zinc-400 mb-8 leading-relaxed">Esta acción removerá la pieza permanentemente de la colección.</p>
        <div className="flex gap-4">
          <button onClick={() => setPhotoToDelete(null)} className="flex-1 px-6 py-4 rounded-full bg-white/5 text-white hover:bg-white/10 transition-colors">Cancelar</button>
          <button onClick={confirmDelete} className="flex-1 px-6 py-4 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all font-bold">ELIMINAR</button>
        </div>
      </Modal>

      {/* Modal: Edit */}
      <Modal isOpen={!!photoToEdit} title="Actualizar Recurso" onClose={() => setPhotoToEdit(null)}>
        <div className="space-y-6">
          <div className="space-y-2">
            <input type="text" value={tempUrl} onChange={e => setTempUrl(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded-2xl px-5 py-4 text-white focus:outline-none focus:ring-2 focus:ring-white/10 transition-all" />
            {photoToEdit?.url === tempUrl && <p className="text-xs text-amber-300 pl-2">La URL es idéntica a la actual.</p>}
          </div>
          <div className='flex gap-4'>
            <button onClick={() => setPhotoToEdit(null)} className="flex-1 px-6 py-4 rounded-full bg-white/5 text-white hover:bg-white/10 transition-colors">Cancelar</button>
            <button onClick={confirmEdit} disabled={photoToEdit?.url === tempUrl || !tempUrl.trim()} className={`flex-1 px-6 py-4 font-bold rounded-full transition-all ${photoToEdit?.url === tempUrl || !tempUrl.trim() ? 'bg-zinc-800 text-zinc-500' : 'bg-white text-black hover:scale-[1.02]'}`}>GUARDAR</button>
          </div>
        </div>
      </Modal>
    </div>
  );
};