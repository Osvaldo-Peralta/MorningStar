// web/src/context/AppContext.tsx
/*
--- Este es el puente entre mi Core en el backend y React
*/
import React, { createContext, useContext, useEffect, useState } from 'react';
import { ModuleRegistry } from '@morningstar/core';
import { InMemoryEventBus } from '@morningstar/core';
import { LocalStorageAdapter } from '@morningstar/core';
import { LocalStoragePersistenceAdapter } from '@morningstar/core';
import { IndexedDbMediaStorage } from '@morningstar/core';
import { RuntimeLoggerModule } from '@morningstar/runtime-logger';
import { PhotoFeedModule } from '@morningstar/photo-feed';
import type { CoreEventMap } from '@morningstar/core';

interface AppContextType {
  photoFeed: PhotoFeedModule;
  events: InMemoryEventBus<CoreEventMap>;
}

const AppCtx = createContext<AppContextType | null>(null);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [instance, setInstance] = useState<AppContextType | null>(null);

  useEffect(() => {
    // Binarios en IndexedDB (ADR-0004): durable en navegador, sobrevive
    // recargas. Las blob URLs se revocan al desmontar (dispose).
    const media = new IndexedDbMediaStorage('morningstar-media');

    const initSystem = async () => {
      // 1. Configuración de Infraestructura
      const eventBus = new InMemoryEventBus<CoreEventMap>();
      const storage = new LocalStorageAdapter('morningstar_v0.2.0');
      // Persistencia con identidad estable (ADR-0003). El prefijo del Storage
      // KV se mantiene para que la migración legacy vea los datos existentes.
      const persistence = new LocalStoragePersistenceAdapter('morningstar_v0.3.0_');

      const context = {
        events: eventBus,
        storage,
        persistence,
        media,
        permission: { has: () => true, request: async () => true },
        logger: console,
        config: { environment: 'development' as const,
                 version: '0.2.0' },
      };

      const registry = new ModuleRegistry(context);

      // 2. Registro e Inicialización de Módulos (Orden determinista)
      const logger = new RuntimeLoggerModule();
      const photoFeed = new PhotoFeedModule();

      registry.register(logger);
      registry.register(photoFeed);

      // Inicializamos en cadena
      await registry.init(logger.id);
      await registry.init(photoFeed.id);

      // Activamos
      await registry.activate(logger.id);
      await registry.activate(photoFeed.id);

      setInstance({ photoFeed, events: eventBus });
    };

    initSystem().catch(console.error);

    return () => {
      // Revoca las blob URLs cacheadas por la sesión
      media.dispose();
    };
  }, []);

  if (!instance) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-900 text-white">
        <p className="animate-pulse">Inicializando Morningstar Core...</p>
      </div>
    );
  }

  return (
    <AppCtx.Provider value={instance}>
      {children}
    </AppCtx.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppCtx);
  if (!context) throw new Error('useApp debe usarse dentro de AppProvider');
  return context;
};