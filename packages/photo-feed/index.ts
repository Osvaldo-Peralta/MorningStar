// modules/photo-feed/index.ts
// Contrato público del módulo: los consumidores (web, bootstrap, otros
// módulos) SOLO deben importar desde aquí ('@morningstar/photo-feed').
export * from './PhotoFeedModule.js'
export * from './PhotoEventMap.js'
export * from './events.js'
export * from './domain/Photo.js'
export * from './domain/PhotoChanges.js'
export * from './domain/EditPhotoInput.js'
export * from './domain/PhotoFeedService.js'
