import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { PhotoCard } from './photo-feed/PhotoCard';
import type { Photo } from '@morningstar/photo-feed';
import { PHOTO_MEDIA_POLICY } from '@morningstar/photo-feed';
import { Modal } from './ui/Modal';
import { SecurityModal } from './auth/SecurityModal';

type AddMode = 'file' | 'url';

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const PhotoFeed: React.FC = () => {
  const { photoFeed, events } = useApp();
  const { actor, user, logout } = useAuth();
  const [photos, setPhotos] = useState<Photo[]>([]);

  // Modal de alta
  const [isAdding, setIsAdding] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>('file');
  const [newUrl, setNewUrl] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modales de edición / borrado
  const [photoToDelete, setPhotoToDelete] = useState<Photo | null>(null);
  const [photoToEdit, setPhotoToEdit] = useState<Photo | null>(null);
  const [tempUrl, setTempUrl] = useState('');
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Modal de Seguridad (8b): MFA, contraseña y dispositivos
  const [isSecurityOpen, setIsSecurityOpen] = useState(false);

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

  const closeAddModal = () => {
    setIsAdding(false);
    setAddError(null);
    setSelectedFile(null);
    setIsDragging(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /**
   * Pre-validación client-side con la política del módulo (feedback
   * instantáneo). La autoridad sigue siendo el dominio: addPhotoFromFile
   * re-valida antes de tocar infraestructura.
   */
  const selectFile = (file: File) => {
    setAddError(null);
    const allowed: readonly string[] = PHOTO_MEDIA_POLICY.allowedMimeTypes;
    if (!allowed.includes(file.type)) {
      setAddError(`Tipo no permitido: ${file.type || 'desconocido'} — usa JPEG, PNG, WebP o GIF`);
      return;
    }
    if (file.size === 0) {
      setAddError('El archivo está vacío');
      return;
    }
    if (file.size > PHOTO_MEDIA_POLICY.maxBytes) {
      setAddError(`Archivo demasiado grande: ${formatBytes(file.size)} (máx ${formatBytes(PHOTO_MEDIA_POLICY.maxBytes)})`);
      return;
    }
    setSelectedFile(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) selectFile(file);
  };

  const handleConfirmAdd = async () => {
    setAddError(null);
    try {
      if (addMode === 'url') {
        if (!newUrl.trim()) return;
        await photoFeed.addPhoto(newUrl.trim(), actor ?? undefined);
        setNewUrl('');
      } else {
        if (!selectedFile) return;
        setIsUploading(true);
        const buffer = await selectedFile.arrayBuffer();
        await photoFeed.addPhotoFromFile({
          data: new Uint8Array(buffer),
          mimeType: selectedFile.type,
        }, actor ?? undefined);
        setSelectedFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
      setIsAdding(false);
    } catch (e) {
      // Incluye PermissionRequiredError/PermissionDeniedError (ADR-0012):
      // el mensaje del error de dominio se muestra tal cual.
      setAddError(e instanceof Error ? e.message : 'Error desconocido');
    } finally {
      setIsUploading(false);
    }
  };

  const confirmEdit = async () => {
    setEditError(null);
    if (photoToEdit && tempUrl && tempUrl !== photoToEdit.url) {
      try {
        await photoFeed.editPhoto(photoToEdit.id, { url: tempUrl }, actor ?? undefined);
        setPhotoToEdit(null);
      } catch (e) {
        setEditError(e instanceof Error ? e.message : 'Error desconocido');
      }
    }
  };

  const confirmDelete = async () => {
    setDeleteError(null);
    if (photoToDelete) {
      try {
        await photoFeed.removePhoto(photoToDelete.id, actor ?? undefined);
        setPhotoToDelete(null);
      } catch (e) {
        setDeleteError(e instanceof Error ? e.message : 'Error desconocido');
      }
    }
  };

  const canConfirmAdd = addMode === 'url' ? !!newUrl.trim() : !!selectedFile;

  return (
    <div className="min-h-screen bg-background text-slate-200">
      <header className="max-w-6xl mx-auto px-8 pt-16 pb-12 flex justify-between items-end">
        <div>
          <h1 className="text-5xl font-extrabold tracking-tighter text-white">MorningStar</h1>
          <p className="text-slate-500 mt-2 font-light italic">Digital Archive v{photoFeed.version}</p>
        </div>
        <div className="flex items-center gap-4">
          {user && (
            <div className="text-right">
              <p className="text-white text-sm font-medium" data-testid="current-user">{user.displayName}</p>
              <p className="text-zinc-500 text-xs">@{user.username}</p>
            </div>
          )}
          <button onClick={() => setIsSecurityOpen(true)} aria-label="Seguridad" className="bg-white/5 text-zinc-300 text-sm px-5 py-3 rounded-full hover:bg-white/10 transition-colors">Seguridad</button>
          <button onClick={() => setIsAdding(true)} className="bg-white text-black text-sm font-bold px-8 py-3 rounded-full hover:bg-slate-200 active:scale-95 active:animate-button-press transition-all duration-300 hover:shadow-[0_8px_30px_rgb(255,255,255,0.12)]">UPLOAD</button>
          <button onClick={() => void logout()} aria-label="Cerrar sesión" className="bg-white/5 text-zinc-300 text-sm px-5 py-3 rounded-full hover:bg-white/10 transition-colors">Salir</button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-8 pb-20">
        <div className="columns-1 sm:columns-2 lg:columns-3 gap-8 space-y-8">
          {photos.map(p => (
            <PhotoCard key={p.id} photo={p} onDelete={() => { setDeleteError(null); setPhotoToDelete(p); }} onEdit={(p) => { setEditError(null); setPhotoToEdit(p); setTempUrl(p.url); }} />
          ))}
        </div>
      </main>

      {/* Modal: Add */}
      <Modal isOpen={isAdding} title="Nueva Fotografía" onClose={closeAddModal}>
        <div className="space-y-6">
          {/* Control segmentado: archivo (flujo principal) vs URL (legado) */}
          <div className="flex bg-white/5 rounded-full p-1">
            <button
              onClick={() => { setAddMode('file'); setAddError(null); }}
              className={`flex-1 px-4 py-2 rounded-full text-sm transition-all ${addMode === 'file' ? 'bg-white text-black font-bold' : 'text-zinc-400 hover:text-white'}`}
            >
              Subir archivo
            </button>
            <button
              onClick={() => { setAddMode('url'); setAddError(null); }}
              className={`flex-1 px-4 py-2 rounded-full text-sm transition-all ${addMode === 'url' ? 'bg-white text-black font-bold' : 'text-zinc-400 hover:text-white'}`}
            >
              Por URL
            </button>
          </div>

          {addMode === 'url' ? (
            <input
              autoFocus
              type="text"
              value={newUrl}
              onChange={e => setNewUrl(e.target.value)}
              className="w-full bg-white/30 border border-white/30 rounded-2xl px-5 py-4 text-white focus:outline-none focus:border-white/20 transition-all placeholder:text-zinc-500"
              placeholder="Enlace de la imagen..."
            />
          ) : (
            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`cursor-pointer border-2 border-dashed rounded-2xl p-8 text-center transition-all ${isDragging ? 'border-white/40 bg-white/10 scale-[1.01]' : 'border-white/15 bg-white/5 hover:border-white/25'}`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept={PHOTO_MEDIA_POLICY.allowedMimeTypes.join(',')}
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) selectFile(file);
                }}
              />
              {selectedFile ? (
                <div className="space-y-1">
                  <p className="text-white font-medium break-all">{selectedFile.name}</p>
                  <p className="text-zinc-400 text-sm">{formatBytes(selectedFile.size)} · {selectedFile.type}</p>
                  <p className="text-zinc-500 text-xs pt-2">Click o arrastra otro archivo para reemplazar</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="mx-auto text-zinc-400">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                  <p className="text-zinc-300">Arrastra una imagen o haz click</p>
                  <p className="text-zinc-500 text-xs">JPEG, PNG, WebP o GIF · máx {formatBytes(PHOTO_MEDIA_POLICY.maxBytes)}</p>
                </div>
              )}
            </div>
          )}

          {addError && <p className="text-sm text-red-400 px-2">{addError}</p>}

          <div className='flex gap-4'>
            <button onClick={closeAddModal} className="flex-1 px-6 py-4 rounded-full bg-white/5 text-white hover:bg-white/10 transition-colors">Cancelar</button>
            <button
              onClick={handleConfirmAdd}
              disabled={!canConfirmAdd || isUploading}
              className={`flex-1 px-6 font-bold py-4 rounded-3xl transition-all ${!canConfirmAdd || isUploading ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed' : 'bg-white text-green-500 hover:bg-green-500/60 hover:text-white'}`}
            >
              {isUploading ? 'SUBIENDO…' : 'AÑADIR'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Delete */}
      <Modal isOpen={!!photoToDelete} title="¿Eliminar del archivo?" onClose={() => setPhotoToDelete(null)}>
        <p className="text-zinc-400 mb-4 leading-relaxed">Esta acción removerá la pieza permanentemente de la colección.</p>
        {deleteError && <p className="text-sm text-red-400 mb-4 px-2">{deleteError}</p>}
        <div className="flex gap-4">
          <button onClick={() => setPhotoToDelete(null)} className="flex-1 px-6 py-4 rounded-full bg-white/5 text-white hover:bg-white/10 transition-all">Cancelar</button>
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
          {editError && <p className="text-sm text-red-400 px-2">{editError}</p>}
          <div className='flex gap-4'>
            <button onClick={() => setPhotoToEdit(null)} className="flex-1 px-6 py-4 rounded-full bg-white/5 text-white hover:bg-white/10 transition-colors">Cancelar</button>
            <button onClick={confirmEdit} disabled={photoToEdit?.url === tempUrl || !tempUrl.trim()} className={`flex-1 px-6 py-4 font-bold rounded-full transition-all ${photoToEdit?.url === tempUrl || !tempUrl.trim() ? 'bg-zinc-800 text-zinc-500' : 'bg-white text-black hover:scale-[1.02]'}`}>GUARDAR</button>
          </div>
        </div>
      </Modal>

      {/* Modal: Seguridad (8b) — MFA, contraseña, dispositivos */}
      <SecurityModal isOpen={isSecurityOpen} onClose={() => setIsSecurityOpen(false)} />
    </div>
  );
};
