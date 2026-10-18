// authentication/AuthenticationModule.ts
import { ModuleState } from '@morningstar/core'
import type { AppModule, CoreContext, Repository } from '@morningstar/core'
import type { CredentialRecord } from './domain/CredentialRecord.js'
import { validatePassword, type PasswordPolicyOverrides } from './domain/PasswordPolicy.js'
import type { PasswordHasher } from './PasswordHasher.js'
import type { UserDirectoryPort } from './UserDirectoryPort.js'
import {
  AccountLockedError,
  AccountNotActiveError,
  InvalidCredentialsError,
  MissingCredentialsError,
} from './errors.js'
import { AUTH_EVENTS } from './events.js'

/** Namespace del repositorio de credenciales (ADR-0002/0003). */
const CREDENTIALS_NAMESPACE = 'auth:credentials'

/** Defaults del lockout anti fuerza-bruta (ADR-0007). */
export const LOCKOUT_DEFAULTS = {
  maxFailedAttempts: 5,
  durationMs: 15 * 60 * 1000, // 15 minutos
} as const

export interface LockoutPolicy {
  readonly maxFailedAttempts?: number
  readonly durationMs?: number
}

export interface AuthenticationModuleOptions {
  /** Puerto de hashing (inyección obligatoria — ADR-0007). */
  readonly passwordHasher: PasswordHasher
  /** Puerto de directorio de usuarios (cableado por la composición). */
  readonly userDirectory: UserDirectoryPort
  /** Overrides de la política de contraseñas (default: 8..128). */
  readonly passwordPolicy?: PasswordPolicyOverrides
  /** Overrides del lockout (default: 5 intentos / 15 min). */
  readonly lockout?: LockoutPolicy
}

/**
 * Resultado de un login exitoso en la Iteración 6a.
 * En 6b se ampliará (aditivo) con la `Session` de la Baseline v1.0 §2:
 * `{ userId, deviceFingerprint, issuedAt, expiresAt, riskSnapshot }`.
 */
export interface LoginResult {
  readonly userId: string
}

/**
 * Módulo de autenticación (Fase 4, Baseline v1.0 §2) — Iteración 6a:
 * credenciales, hashing de contraseñas y login/logout lógico.
 *
 * Seguridad por diseño (ADR-0007):
 * - Solo el hash auto-descriptivo se persiste; el claro nunca.
 * - Anti-enumeración: usuario inexistente, sin credenciales y contraseña
 *   incorrecta producen el MISMO error; el trabajo de hashing se iguala con
 *   un hash dummy para reducir la señal por timing.
 * - Lockout: `maxFailedAttempts` fallos consecutivos ⇒ `durationMs` de bloqueo.
 * - El estado de cuenta solo se evalúa (y revela) TRAS validar la contraseña.
 * - Solo cuentas ACTIVE pueden loguearse.
 *
 * Requiere `context.persistence`. Sesiones, refresh, fingerprinting, MFA y
 * reset por email llegan en 6b/6c.
 */
export class AuthenticationModule implements AppModule {
  readonly id = 'authentication'
  readonly version = '0.1.0'

  private readonly hasher: PasswordHasher
  private readonly directory: UserDirectoryPort
  private readonly passwordPolicy: PasswordPolicyOverrides
  private readonly maxFailedAttempts: number
  private readonly lockoutDurationMs: number

  private credentials?: Repository<CredentialRecord>
  private events?: CoreContext['events']

  /** Hash dummy memoizado: iguala el costo temporal en logins con usuario inexistente. */
  private dummyHashPromise?: Promise<string>

  state = ModuleState.Registered

  constructor(options: AuthenticationModuleOptions) {
    if (!options.passwordHasher) {
      throw new Error("AuthenticationModule requiere 'passwordHasher' (PasswordHasher)")
    }
    if (!options.userDirectory) {
      throw new Error("AuthenticationModule requiere 'userDirectory' (UserDirectoryPort)")
    }
    this.hasher = options.passwordHasher
    this.directory = options.userDirectory
    this.passwordPolicy = options.passwordPolicy ?? {}
    this.maxFailedAttempts = options.lockout?.maxFailedAttempts ?? LOCKOUT_DEFAULTS.maxFailedAttempts
    this.lockoutDurationMs = options.lockout?.durationMs ?? LOCKOUT_DEFAULTS.durationMs
  }

  async init(context: CoreContext): Promise<void> {
    if (!context.persistence) {
      throw new Error(
        "AuthenticationModule requiere 'context.persistence' (PersistenceProvider). Ver docs/contracts/authentication.md"
      )
    }
    this.credentials = context.persistence.repository<CredentialRecord>(CREDENTIALS_NAMESPACE)
    this.events = context.events
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async dispose(): Promise<void> {
    this.credentials = undefined
    this.events = undefined
    this.dummyHashPromise = undefined
  }

  /** API pública del módulo */

  /**
   * Establece la contraseña de un usuario (comando de sistema: alta inicial o
   * reset administrativo). El flujo de usuario con contraseña actual es
   * `changePassword`; el reset self-service por email llega en 6c.
   */
  async setPassword(userId: string, password: string): Promise<void> {
    if (!this.credentials || !this.events) throw new Error('Not Initialized')

    validatePassword(password, this.passwordPolicy)

    const existing = await this.credentials.get(userId)
    const passwordHash = await this.hasher.hash(password)
    const now = Date.now()

    await this.credentials.save({
      id: userId,
      passwordHash,
      failedAttempts: 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })

    this.events.emit({
      name: AUTH_EVENTS.PASSWORD_SET,
      category: 'domain',
      source: { moduleId: this.id, entity: 'credentials', entityId: userId },
      payload: { userId },
      timestamp: Date.now(),
    })
  }

  /** Cambio de contraseña de usuario: exige la contraseña actual. */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    if (!this.credentials || !this.events) throw new Error('Not Initialized')

    const record = await this.credentials.get(userId)
    if (!record) throw new MissingCredentialsError(userId)

    const valid = await this.hasher.verify(currentPassword, record.passwordHash)
    if (!valid) {
      // Anti-enumeración interna: mismo error genérico
      throw new InvalidCredentialsError()
    }

    validatePassword(newPassword, this.passwordPolicy)

    const now = Date.now()
    await this.credentials.save({
      ...record,
      passwordHash: await this.hasher.hash(newPassword),
      failedAttempts: 0,
      lockedUntil: undefined,
      updatedAt: now,
    })

    this.events.emit({
      name: AUTH_EVENTS.PASSWORD_CHANGED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'credentials', entityId: userId },
      payload: { userId },
      timestamp: Date.now(),
    })
  }

  /**
   * Login por username o email + contraseña.
   * Orden de chequeos (ADR-0007): directorio → credenciales → lockout →
   * contraseña → estado de cuenta. El estado solo se revela con contraseña
   * válida.
   */
  async login(identifier: string, password: string): Promise<LoginResult> {
    if (!this.credentials || !this.events) throw new Error('Not Initialized')

    // 1. Directorio (username o email; la normalización la hace el adaptador)
    const entry = await this.directory.lookupUser(identifier)
    const record = entry ? await this.credentials.get(entry.userId) : null

    if (!entry || !record) {
      // Anti-enumeración: mismo error + mismo trabajo criptográfico
      await this.hasher.verify(password, await this.dummyHash())
      this.events.emit({
        name: AUTH_EVENTS.LOGIN_FAILED,
        category: 'domain',
        source: { moduleId: this.id, entity: 'session' },
        payload: { reason: 'invalid-credentials' },
        timestamp: Date.now(),
      })
      throw new InvalidCredentialsError()
    }

    const now = Date.now()

    // 2. Lockout vigente
    if (record.lockedUntil !== undefined && now < record.lockedUntil) {
      this.events.emit({
        name: AUTH_EVENTS.LOGIN_FAILED,
        category: 'domain',
        source: { moduleId: this.id, entity: 'session', entityId: entry.userId },
        payload: { userId: entry.userId, reason: 'locked' },
        timestamp: now,
      })
      throw new AccountLockedError(record.lockedUntil - now)
    }

    // 3. Verificación de contraseña (constant-time dentro del hasher)
    const passwordValid = await this.hasher.verify(password, record.passwordHash)
    if (!passwordValid) {
      const failedAttempts = record.failedAttempts + 1
      const mustLock = failedAttempts >= this.maxFailedAttempts
      const lockedUntil = mustLock ? now + this.lockoutDurationMs : undefined

      await this.credentials.save({
        ...record,
        failedAttempts: mustLock ? 0 : failedAttempts,
        lockedUntil,
        updatedAt: now,
      })

      this.events.emit({
        name: AUTH_EVENTS.LOGIN_FAILED,
        category: 'domain',
        source: { moduleId: this.id, entity: 'session', entityId: entry.userId },
        payload: { userId: entry.userId, reason: 'invalid-credentials', failedAttempts },
        timestamp: now,
      })

      if (mustLock) {
        this.events.emit({
          name: AUTH_EVENTS.ACCOUNT_LOCKED,
          category: 'domain',
          source: { moduleId: this.id, entity: 'credentials', entityId: entry.userId },
          payload: { userId: entry.userId, lockedUntil: lockedUntil! },
          timestamp: now,
        })
        throw new AccountLockedError(this.lockoutDurationMs)
      }
      throw new InvalidCredentialsError()
    }

    // 4. Estado de cuenta (revelado solo al dueño legítimo de la contraseña)
    if (entry.accountStatus !== 'ACTIVE') {
      this.events.emit({
        name: AUTH_EVENTS.LOGIN_FAILED,
        category: 'domain',
        source: { moduleId: this.id, entity: 'session', entityId: entry.userId },
        payload: {
          userId: entry.userId,
          reason: 'account-not-active',
          accountStatus: entry.accountStatus,
        },
        timestamp: now,
      })
      throw new AccountNotActiveError(entry.accountStatus)
    }

    // 5. Éxito: reset de contadores
    if (record.failedAttempts > 0 || record.lockedUntil !== undefined) {
      await this.credentials.save({
        ...record,
        failedAttempts: 0,
        lockedUntil: undefined,
        updatedAt: Date.now(),
      })
    }

    this.events.emit({
      name: AUTH_EVENTS.LOGIN_SUCCEEDED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'session', entityId: entry.userId },
      payload: { userId: entry.userId },
      timestamp: now,
    })

    return { userId: entry.userId }
  }

  private dummyHash(): Promise<string> {
    this.dummyHashPromise ??= this.hasher.hash('dummy-password-for-timing-equalization')
    return this.dummyHashPromise
  }
}
