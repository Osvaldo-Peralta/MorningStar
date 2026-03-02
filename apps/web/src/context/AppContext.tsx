// web/src/context/AppContext.tsx
/*
--- Este es el puente entre mi Core en el backend y React
*/
import React, { createContext, useContext, useEffect, useState } from 'react';
import { ModuleRegistry } from '@morningstar/core';
import { InMemoryEventBus } from '@morningstar/core';
import { LocalStorageAdapter } from '@morningstar/core';
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
    const initSystem = async () => {
      // 1. Configuración de Infraestructura
      const eventBus = new InMemoryEventBus<CoreEventMap>();
      const storage = new LocalStorageAdapter('morningstar_v0.2.0');

      const context = {
        events: eventBus,
        storage,
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