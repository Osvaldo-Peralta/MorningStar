// core/index.ts

// contratos del contexto (core)
export * from './context/CoreContext.js'
export * from './context/CoreEventMap.js'
export * from './context/InMemoryEventBus.js'
export * from './context/DomainEvent.js'
export * from './context/EventBus.js'
export * from './context/events.js'
export * from './context/EventCategory.js'
export * from './context/Storage.js'
export * from './context/Persistence.js'
export * from './context/MediaStorage.js'
export * from './context/Permission.js'
export * from './context/Logger.js'
export * from './context/Config.js'

// sistema de módulos
export * from './module/AppModule.js'
export * from './module/ModuleLifecycle.js'
export * from './module/ModuleMetadata.js'
export * from './module/ModuleState.js'
export * from './module/ModuleRegistry.js'
export * from './module/errors.js'

// adaptadores de infraestructura
export * from './infraestructure/LocalStorageAdapter.js'
export * from './infraestructure/InMemoryStorageAdapter.js'
export * from './infraestructure/InMemoryPersistenceAdapter.js'
export * from './infraestructure/LocalStoragePersistenceAdapter.js'
export * from './infraestructure/InMemoryMediaStorage.js'
export * from './infraestructure/IndexedDbMediaStorage.js'
