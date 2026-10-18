// authentication/AuthenticationModule.ts
import { ModuleState } from '@morningstar/core'
import type { AppModule, CoreContext, Repository } from '@morningstar/core'
import type { CredentialRecord } from './domain/CredentialRecord.js'
import type {
  DeviceInfo,
  SessionInfo,
  SessionRecord,
} from './domain/SessionRecord.js'
import { toSessionInfo } from './domain/SessionRecord.js'
import { generateOpaqueToken, hashOpaqueToken } from './infraestructure/sessionToken.js'
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

/** Namespace del repositorio de sesiones (ADR-0008). */
const SESSIONS_NAMESPACE = 'auth:sessions'

/** Defaults del lockout anti fuerza-bruta (ADR-0007). */
export const LOCKOUT_DEFAULTS = {
  maxFailedAttempts: 5,
  durationMs: 15 * 60 * 1000, // 15 minutos
} as const

/** Defaults de sesión (ADR-0008). */
export const SESSION_DEFAULTS = {
  accessTokenTtlMs: 60 * 60 * 1000, // 60 minutos
} as const

export interface SessionPolicy {
  readonly accessTokenTtlMs?: number
}

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
  /** Overrides de sesiones (default: TTL 60 min — ADR-0008). */
  readonly session?: SessionPolicy
}

/**
 * Resultado de un login exitoso.
 * `userId` se conserva por compatibilidad con la Iteración 6a; `session`
 * (token opaco + metadata) se agregó de forma aditiva en 6b con la Session de
 * la Baseline v1.0 §2 (ADR-0008). El `token` se entrega UNA sola vez aquí.
 */
export interface LoginResult {
  readonly userId: string
  readonly session: SessionInfo & { readonly token: string }
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
  readonly version = '0.2.0'

  private readonly hasher: PasswordHasher
  private readonly directory: UserDirectoryPort
  private readonly passwordPolicy: PasswordPolicyOverrides
  private readonly maxFailedAttempts: number
  private readonly lockoutDurationMs: number
  private readonly accessTokenTtlMs: number

  private credentials?: Repository<CredentialRecord>
  private sessions?: Repository<SessionRecord>
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
    this.accessTokenTtlMs = options.session?.accessTokenTtlMs ?? SESSION_DEFAULTS.accessTokenTtlMs
  }

  async init(context: CoreContext): Promise<void> {
    if (!context.persistence) {
      throw new Error(
        "AuthenticationModule requiere 'context.persistence' (PersistenceProvider). Ver docs/contracts/authentication.md"
      )
    }
    this.credentials = context.persistence.repository<CredentialRecord>(CREDENTIALS_NAMESPACE)
    this.sessions = context.persistence.repository<SessionRecord>(SESSIONS_NAMESPACE)
    this.events = context.events
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async dispose(): Promise<void> {
    this.credentials = undefined
    this.sessions = undefined
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
   * Login por username o email + contraseña (Baseline v1.0 §2: session
   * issuance). `device` es opcional: el fingerprint lo aporta el cliente
   * (ADR-0008).
   *
   * Orden de chequeos (ADR-0007): directorio → credenciales → lockout →
   * contraseña → estado de cuenta → emisión de sesión. El estado solo se
   * revela con contraseña válida.
   */
  async login(identifier: string, password: string, device?: DeviceInfo): Promise<LoginResult> {
    if (!this.credentials || !this.sessions || !this.events) throw new Error('Not Initialized')

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

    // 6. Emisión de sesión (Baseline §2: userId, deviceFingerprint, issuedAt,
    //    expiresAt, riskSnapshot). Token opaco: solo se persiste su hash y
    //    solo se entrega aquí, una vez (ADR-0008).
    const token = generateOpaqueToken()
    const sessionId = await hashOpaqueToken(token)
    const issuedAt = Date.now()
    const expiresAt = issuedAt + this.accessTokenTtlMs
    const deviceFingerprint = device?.fingerprint ?? 'unknown'

    const sessionRecord: SessionRecord = {
      id: sessionId,
      userId: entry.userId,
      deviceFingerprint,
      issuedAt,
      expiresAt,
      lastSeenAt: issuedAt,
      riskSnapshot: { riskLevel: 'UNKNOWN' }, // Fase 8 (Risk Engine) lo poblará
    }
    await this.sessions.save(sessionRecord)

    this.events.emit({
      name: AUTH_EVENTS.LOGIN_SUCCEEDED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'session', entityId: entry.userId },
      payload: { userId: entry.userId },
      timestamp: now,
    })

    this.events.emit({
      name: AUTH_EVENTS.SESSION_ISSUED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'session', entityId: entry.userId },
      payload: { userId: entry.userId, sessionId, deviceFingerprint, expiresAt },
      timestamp: now,
    })

    return {
      userId: entry.userId,
      session: { ...toSessionInfo(sessionRecord), token },
    }
  }

  /**
   * Valida un token de sesión. Devuelve `null` si es desconocido, expirado o
   * revocado (nunca revela cuál de los tres). Actualiza `lastSeenAt`
   * (audit/UX de dispositivos activos).
   */
  async validateSession(token: string): Promise<SessionInfo | null> {
    if (!this.sessions) throw new Error('Not Initialized')

    const record = await this.sessions.get(await hashOpaqueToken(token))
    if (!record || record.revokedAt !== undefined) return null

    const now = Date.now()
    if (now > record.expiresAt) return null // expiración lazy (sin GC write)

    const touched: SessionRecord = { ...record, lastSeenAt: now }
    await this.sessions.save(touched)
    return toSessionInfo(touched)
  }

  /** Logout de una sesión. Devuelve false si el token no existe o ya estaba revocado. */
  async logout(token: string): Promise<boolean> {
    if (!this.sessions || !this.events) throw new Error('Not Initialized')

    const record = await this.sessions.get(await hashOpaqueToken(token))
    if (!record || record.revokedAt !== undefined) return false

    await this.revokeSession(record, 'logout')
    return true
  }

  /** Revoca todas las sesiones activas de un usuario. Devuelve cuántas revocó. */
  async logoutUser(userId: string, _reason?: string): Promise<number> {
    if (!this.sessions || !this.events) throw new Error('Not Initialized')

    const now = Date.now()
    const all = await this.sessions.list()
    let count = 0
    for (const record of all) {
      if (record.userId === userId && record.revokedAt === undefined && now <= record.expiresAt) {
        await this.revokeSession(record, 'logout-all')
        count++
      }
    }
    return count
  }

  /**
   * Invalidación masiva global — primitiva de ACTIVE_DEFENSE (Baseline v1.0
   * §2). Revoca TODAS las sesiones activas del sistema y emite un único
   * evento agregado (no uno por sesión: puede ser masivo).
   */
  async invalidateAllSessions(reason: string): Promise<number> {
    if (!this.sessions || !this.events) throw new Error('Not Initialized')

    const now = Date.now()
    const all = await this.sessions.list()
    let count = 0
    for (const record of all) {
      if (record.revokedAt === undefined && now <= record.expiresAt) {
        await this.sessions.save({
          ...record,
          revokedAt: now,
          revokedReason: 'mass-invalidation',
        })
        count++
      }
    }

    this.events.emit({
      name: AUTH_EVENTS.SESSIONS_INVALIDATED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'session' },
      payload: { count, reason },
      timestamp: Date.now(),
    })

    return count
  }

  /** Sesiones activas de un usuario (UX "tus dispositivos"). Nunca expone tokens. */
  async listSessions(userId: string): Promise<SessionInfo[]> {
    if (!this.sessions) throw new Error('Not Initialized')

    const now = Date.now()
    const all = await this.sessions.list()
    return all
      .filter((r) => r.userId === userId && r.revokedAt === undefined && now <= r.expiresAt)
      .map(toSessionInfo)
  }

  private async revokeSession(record: SessionRecord, reason: 'logout' | 'logout-all'): Promise<void> {
    const now = Date.now()
    await this.sessions!.save({ ...record, revokedAt: now, revokedReason: reason })

    this.events!.emit({
      name: AUTH_EVENTS.SESSION_REVOKED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'session', entityId: record.userId },
      payload: { sessionId: record.id, userId: record.userId, reason },
      timestamp: now,
    })
  }

  private dummyHash(): Promise<string> {
    this.dummyHashPromise ??= this.hasher.hash('dummy-password-for-timing-equalization')
    return this.dummyHashPromise
  }
}
