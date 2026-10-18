// packages/authentication/index.ts
// Contrato público del módulo: los consumidores SOLO deben importar desde
// aquí ('@morningstar/authentication').
export * from './AuthenticationModule.js'
export * from './AuthenticationEventMap.js'
export * from './PasswordHasher.js'
export * from './UserDirectoryPort.js'
export * from './events.js'
export * from './errors.js'
export * from './domain/PasswordPolicy.js'
export * from './domain/CredentialRecord.js'
export * from './domain/SessionRecord.js'
export * from './domain/RefreshTokenRecord.js'
export * from './domain/PasswordResetTokenRecord.js'
export * from './domain/MfaRecord.js'
export * from './domain/TotpService.js'
export * from './infraestructure/Pbkdf2PasswordHasher.js'
