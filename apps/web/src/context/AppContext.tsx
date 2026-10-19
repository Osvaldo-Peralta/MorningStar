// web/src/context/AppContext.tsx
/*
--- Puente entre la plataforma MorningStar (core + módulos) y React.
--- Composición completa (ADR-0013): infraestructura, módulos, puertos
--- cruzados (userDirectory, sessionValidator, actorDirectory, authorizer).
*/
import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  ModuleRegistry,
  InMemoryEventBus,
  InMemoryEmailDelivery,
  LocalStorageAdapter,
  LocalStoragePersistenceAdapter,
  IndexedDbMediaStorage,
} from '@morningstar/core';
import type { CoreEventMap } from '@morningstar/core';
import { RuntimeLoggerModule } from '@morningstar/runtime-logger';
import { PhotoFeedModule } from '@morningstar/photo-feed';
import { IdentityModule } from '@morningstar/identity';
import { AuthenticationModule, Pbkdf2PasswordHasher } from '@morningstar/authentication';
import { AuthorizationModule } from '@morningstar/authorization';

export interface AppContextType {
  photoFeed: PhotoFeedModule;
  identity: IdentityModule;
  authentication: AuthenticationModule;
  authorization: AuthorizationModule;
  events: InMemoryEventBus<CoreEventMap>;
  /** Dev/tests: bandeja de salida inspeccionable (ADR-0013). */
  emailDelivery: InMemoryEmailDelivery;
  environment: 'development' | 'test' | 'production';
}

const AppCtx = createContext<AppContextType | null>(null);

/** Fingerprint mínimo del dispositivo: UUID estable por navegador (ADR-0013). */
export function webDeviceFingerprint(): string {
  const KEY = 'morningstar.device';
  let fingerprint = localStorage.getItem(KEY);
  if (!fingerprint) {
    fingerprint = crypto.randomUUID();
    localStorage.setItem(KEY, fingerprint);
  }
  return fingerprint;
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [instance, setInstance] = useState<AppContextType | null>(null);

  useEffect(() => {
    // Binarios en IndexedDB (ADR-0004): durable en navegador.
    const media = new IndexedDbMediaStorage('morningstar-media');
    // Email en memoria con outbox inspeccionable (dev); el proveedor real
    // llegará con el backend (ADR-0006/0013).
    const emailDelivery = new InMemoryEmailDelivery();

    const initSystem = async () => {
      // 1. Infraestructura
      const eventBus = new InMemoryEventBus<CoreEventMap>();
      const storage = new LocalStorageAdapter('morningstar_v0.2.0');
      const persistence = new LocalStoragePersistenceAdapter('morningstar_v0.3.0_');

      // 2. Módulos (instancias primero: la composición los referencia vía puertos)
      const logger = new RuntimeLoggerModule();
      const photoFeed = new PhotoFeedModule();
      const identity = new IdentityModule();
      const authentication = new AuthenticationModule({
        // En tests web: iteraciones bajas (jsdom + suites rápidas); en el
        // navegador real, default OWASP 600k (ADR-0007).
        passwordHasher: new Pbkdf2PasswordHasher(
          import.meta.env.VITEST ? { iterations: 1000 } : {}
        ),
        userDirectory: {
          lookupUser: async (identifier) => {
            const user =
              (await identity.getByUsername(identifier)) ??
              (await identity.getByEmail(identifier));
            return user
              ? { userId: user.id, accountStatus: user.accountStatus, email: user.email }
              : null;
          },
          getUserAccount: async (userId) => {
            const user = await identity.getUser(userId);
            return user
              ? { userId: user.id, accountStatus: user.accountStatus, email: user.email }
              : null;
          },
        },
      });
      const authorization = new AuthorizationModule({
        sessionValidator: {
          validateSession: async (token) => {
            const session = await authentication.validateSession(token);
            return session
              ? {
                  userId: session.userId,
                  sessionId: session.sessionId,
                  deviceFingerprint: session.deviceFingerprint,
                  issuedAt: session.issuedAt,
                  expiresAt: session.expiresAt,
                  riskLevel: session.riskSnapshot.riskLevel,
                }
              : null;
          },
        },
        actorDirectory: {
          getActor: async (userId) => {
            const user = await identity.getUser(userId);
            return user
              ? {
                  accountStatus: user.accountStatus,
                  accountType: user.accountType,
                  verifiedAttributes: user.verificationFlags.emailVerified ? ['email'] : [],
                }
              : null;
          },
        },
      });

      // 3. CoreContext (authorizer activo ⇒ PhotoFeed opera fail-closed con actor)
      const context = {
        events: eventBus,
        storage,
        persistence,
        media,
        email: emailDelivery,
        authorizer: authorization,
        permission: { has: () => true, request: async () => true },
        logger: console,
        config: {
          environment: 'development' as const,
          version: '0.3.0',
        },
      };

      // 4. Registro e inicialización determinista
      const registry = new ModuleRegistry(context);

      await logger.init(context); // el logger escucha antes del registro
      registry.register(logger);
      await registry.init(logger.id);
      await registry.activate(logger.id);

      for (const module of [photoFeed, identity, authentication, authorization]) {
        registry.register(module);
        await registry.init(module.id);
        await registry.activate(module.id);
      }

      setInstance({
        photoFeed,
        identity,
        authentication,
        authorization,
        events: eventBus,
        emailDelivery,
        environment: 'development',
      });
    };

    initSystem().catch(console.error);

    return () => {
      media.dispose(); // revoca blob URLs cacheadas
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
