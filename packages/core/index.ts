// core/module/index.ts

// de paquetes del core
export * from './context/CoreContext'
export * from './context/CoreEventMap'
export * from './context/InMemoryEventBus'
export * from './context/DomainEvent'

// de paquetes del module
export * from './module/AppModule'
export * from './module/ModuleLifecycle'
export * from './module/ModuleMetadata'
export * from './module/ModuleState'
export * from './module/ModuleRegistry'
export * from './module/errors'

// de paquetes del infraestructure
export * from './infraestructure/LocalStorageAdapter'