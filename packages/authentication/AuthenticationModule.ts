// authentication/AuthenticationModule.ts
import { ModuleState } from '@morningstar/core'
import type { AppModule, CoreContext, EmailDelivery, Repository } from '@morningstar/core'
import type { CredentialRecord } from './domain/CredentialRecord.js'
import type { RefreshTokenRecord } from './domain/RefreshTokenRecord.js'
import type { PasswordResetTokenRecord } from './domain/PasswordResetTokenRecord.js'
import type {
  MfaActivation,
  MfaChallengeRecord,
  MfaEnrollment,
  MfaRecord,
  MfaStatus,
} from './domain/MfaRecord.js'
import { TotpService } from './domain/TotpService.js'
import type {
  DeviceInfo,
  SessionInfo,
  SessionRecord,
  SessionRevokedReason,
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
  InvalidMfaChallengeError,
  InvalidMfaCodeError,
  InvalidRefreshTokenError,
  InvalidResetTokenError,
  MfaAlreadyActiveError,
  MfaNotEnrolledError,
  MfaRequiredError,
  MissingCredentialsError,
  RefreshTokenReuseError,
  ResetTokenAlreadyUsedError,
  ResetTokenExpiredError,
  ResetTokenInvalidatedError,
  UnknownUserError,
} from './errors.js'
import { AUTH_EVENTS } from './events.js'

/** Namespaces del módulo (ADR-0002/0003). */
const CREDENTIALS_NAMESPACE = 'auth:credentials'
const SESSIONS_NAMESPACE = 'auth:sessions'
const REFRESH_TOKENS_NAMESPACE = 'auth:refresh-tokens'
const PASSWORD_RESET_TOKENS_NAMESPACE = 'auth:password-reset-tokens'
const MFA_NAMESPACE = 'auth:mfa'
const MFA_CHALLENGES_NAMESPACE = 'auth:mfa-challenges'

/** Defaults del lockout anti fuerza-bruta (ADR-0007). */
export const LOCKOUT_DEFAULTS = {
  maxFailedAttempts: 5,
  durationMs: 15 * 60 * 1000, // 15 minutos
} as const

/** Defaults de sesión y refresh (ADR-0008/0009). */
export const SESSION_DEFAULTS = {
  accessTokenTtlMs: 60 * 60 * 1000,           // 60 minutos
  refreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 días
} as const

/** Defaults del reset de contraseña self-service (ADR-0009). */
export const PASSWORD_RESET_DEFAULTS = {
  tokenTtlMs: 60 * 60 * 1000, // 1 hora
} as const

/** Defaults del challenge MFA de login (ADR-0010). */
export const MFA_CHALLENGE_DEFAULTS = {
  challengeTtlMs: 5 * 60 * 1000, // 5 minutos
  maxAttempts: 5,                 // intentos de código por challenge
  backupCodes: 10,
} as const

/** Base del enlace de reset (placeholder hasta que exista la app pública — ADR-0009). */
export const PASSWORD_RESET_LINK_BASE = 'https://morningstar.app/reset-password'

/** Alfabeto de backup codes sin caracteres ambiguos (0/O, 1/I). */
const BACKUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function generateBackupCodes(count: number): string[] {
  const codes: string[] = []
  for (let i = 0; i < count; i++) {
    const bytes = crypto.getRandomValues(new Uint8Array(10))
    const chars = Array.from(bytes, (byte) => BACKUP_CODE_ALPHABET[byte % BACKUP_CODE_ALPHABET.length]!).join('')
    codes.push(`${chars.slice(0, 5)}-${chars.slice(5)}`)
  }
  return codes
}

function normalizeBackupCode(code: string): string {
  return code.trim().toUpperCase().replace(/[\s-]/g, '')
}

export interface SessionPolicy {
  readonly accessTokenTtlMs?: number
  readonly refreshTokenTtlMs?: number
}

export interface PasswordResetPolicy {
  readonly tokenTtlMs?: number
}

export interface MfaPolicy {
  readonly challengeTtlMs?: number
  readonly maxAttempts?: number
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
  /** Overrides de sesiones y refresh (defaults: 60 min / 30 días — ADR-0008/0009). */
  readonly session?: SessionPolicy
  /** Overrides del reset de contraseña (default: tokens de 1 h — ADR-0009). */
  readonly passwordReset?: PasswordResetPolicy
  /** Overrides de MFA (defaults: challenge 5 min, 5 intentos — ADR-0010). */
  readonly mfa?: MfaPolicy
  /** Servicio TOTP inyectable (tests con reloj determinista — ADR-0010). */
  readonly totp?: TotpService
}

/**
 * Resultado de un login/refresh exitoso.
 * `userId` se conserva por compatibilidad con 6a; `session` (6b) y
 * `refreshToken` (6c) son aditivos. Ambos tokens se entregan UNA sola vez.
 */
export interface LoginResult {
  readonly userId: string
  readonly session: SessionInfo & { readonly token: string }
  readonly refreshToken: string
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
  readonly version = '0.4.0'

  private readonly hasher: PasswordHasher
  private readonly directory: UserDirectoryPort
  private readonly passwordPolicy: PasswordPolicyOverrides
  private readonly maxFailedAttempts: number
  private readonly lockoutDurationMs: number
  private readonly accessTokenTtlMs: number
  private readonly refreshTokenTtlMs: number
  private readonly resetTokenTtlMs: number
  private readonly mfaChallengeTtlMs: number
  private readonly mfaMaxAttempts: number
  private readonly totp: TotpService

  private credentials?: Repository<CredentialRecord>
  private sessions?: Repository<SessionRecord>
  private refreshTokens?: Repository<RefreshTokenRecord>
  private resetTokens?: Repository<PasswordResetTokenRecord>
  private mfaRecords?: Repository<MfaRecord>
  private mfaChallenges?: Repository<MfaChallengeRecord>
  private emailDelivery?: EmailDelivery
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
    this.refreshTokenTtlMs = options.session?.refreshTokenTtlMs ?? SESSION_DEFAULTS.refreshTokenTtlMs
    this.resetTokenTtlMs = options.passwordReset?.tokenTtlMs ?? PASSWORD_RESET_DEFAULTS.tokenTtlMs
    this.mfaChallengeTtlMs = options.mfa?.challengeTtlMs ?? MFA_CHALLENGE_DEFAULTS.challengeTtlMs
    this.mfaMaxAttempts = options.mfa?.maxAttempts ?? MFA_CHALLENGE_DEFAULTS.maxAttempts
    this.totp = options.totp ?? new TotpService()
  }

  async init(context: CoreContext): Promise<void> {
    if (!context.persistence) {
      throw new Error(
        "AuthenticationModule requiere 'context.persistence' (PersistenceProvider). Ver docs/contracts/authentication.md"
      )
    }
    this.credentials = context.persistence.repository<CredentialRecord>(CREDENTIALS_NAMESPACE)
    this.sessions = context.persistence.repository<SessionRecord>(SESSIONS_NAMESPACE)
    this.refreshTokens = context.persistence.repository<RefreshTokenRecord>(REFRESH_TOKENS_NAMESPACE)
    this.resetTokens = context.persistence.repository<PasswordResetTokenRecord>(PASSWORD_RESET_TOKENS_NAMESPACE)
    this.mfaRecords = context.persistence.repository<MfaRecord>(MFA_NAMESPACE)
    this.mfaChallenges = context.persistence.repository<MfaChallengeRecord>(MFA_CHALLENGES_NAMESPACE)
    this.emailDelivery = context.email
    this.events = context.events
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async dispose(): Promise<void> {
    this.credentials = undefined
    this.sessions = undefined
    this.refreshTokens = undefined
    this.resetTokens = undefined
    this.mfaRecords = undefined
    this.mfaChallenges = undefined
    this.emailDelivery = undefined
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

    // Cambio de contraseña ⇒ las sesiones vigentes no sobreviven (ADR-0009).
    // Los refresh tokens quedan inofensivos: refresh valida la sesión y está revocada.
    const sessionsRevoked = await this.revokeUserSessions(userId, 'password-changed')

    this.events.emit({
      name: AUTH_EVENTS.PASSWORD_CHANGED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'credentials', entityId: userId },
      payload: { userId, sessionsRevoked },
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
    if (!this.credentials || !this.sessions || !this.refreshTokens || !this.mfaRecords || !this.mfaChallenges || !this.events) throw new Error('Not Initialized')

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

    // 5b. MFA activo ⇒ challenge de segundo factor; NO se emite sesión todavía
    //     (ADR-0010). El cliente continúa con completeMfaLogin(mfaToken, code).
    const mfa = await this.mfaRecords!.get(entry.userId)
    if (mfa && mfa.status === 'active') {
      const mfaToken = generateOpaqueToken()
      await this.mfaChallenges!.save({
        id: await hashOpaqueToken(mfaToken),
        userId: entry.userId,
        deviceFingerprint: device?.fingerprint ?? 'unknown',
        createdAt: now,
        expiresAt: now + this.mfaChallengeTtlMs,
        attempts: 0,
      })

      this.events.emit({
        name: AUTH_EVENTS.LOGIN_MFA_REQUIRED,
        category: 'domain',
        source: { moduleId: this.id, entity: 'session', entityId: entry.userId },
        payload: { userId: entry.userId },
        timestamp: Date.now(),
      })

      throw new MfaRequiredError(mfaToken)
    }

    // 6. Emisión de sesión + refresh token (ADR-0008/0009)
    return this.issueSession(entry.userId, device?.fingerprint ?? 'unknown', now)
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
    return this.revokeUserSessions(userId, 'logout-all')
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

  private async revokeUserSessions(userId: string, reason: SessionRevokedReason): Promise<number> {    const now = Date.now()
    const all = await this.sessions!.list()
    let count = 0
    for (const record of all) {
      if (record.userId === userId && record.revokedAt === undefined && now <= record.expiresAt) {
        await this.revokeSession(record, reason)
        count++
      }
    }
    return count
  }

  private async revokeSession(record: SessionRecord, reason: SessionRevokedReason): Promise<void> {
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

  /**
   * Refresca la autenticación con rotación completa del par (ADR-0009):
   * sesión nueva + refresh token nuevo; la sesión anterior se revoca
   * ('rotated') y el RT anterior queda consumido (lineage).
   *
   * Detección de reuso: presentar un RT ya consumido revoca la sesión
   * asociada ('reuse-detected') y emite `auth:refresh-reuse-detected`.
   */
  async refresh(refreshTokenValue: string): Promise<LoginResult> {
    if (!this.sessions || !this.refreshTokens || !this.events) throw new Error('Not Initialized')

    const rtHash = await hashOpaqueToken(refreshTokenValue)
    const rt = await this.refreshTokens.get(rtHash)
    const now = Date.now()

    if (!rt || rt.revokedAt !== undefined || now > rt.expiresAt) {
      throw new InvalidRefreshTokenError()
    }

    // Reuso de token consumido ⇒ posible robo. Revocación de FAMILIA (OAuth
    // BCP): seguimos el lineage de rotación hasta el descendiente más reciente
    // y revocamos SU sesión — que es la que podría estar usando el atacante
    // (o la del usuario legítimo; ante la duda, la familia completa cae).
    if (rt.consumedAt !== undefined) {
      let latest: RefreshTokenRecord = rt
      const visited = new Set<string>([latest.id])
      while (latest.rotatedToHash && !visited.has(latest.rotatedToHash)) {
        const next = await this.refreshTokens.get(latest.rotatedToHash)
        if (!next) break
        visited.add(next.id)
        latest = next
      }

      const liveSession = await this.sessions.get(latest.sessionId)
      if (liveSession && liveSession.revokedAt === undefined) {
        await this.revokeSession(liveSession, 'reuse-detected')
      }

      this.events.emit({
        name: AUTH_EVENTS.REFRESH_REUSE_DETECTED,
        category: 'domain',
        source: { moduleId: this.id, entity: 'session', entityId: rt.userId },
        payload: { userId: rt.userId, sessionId: latest.sessionId },
        timestamp: now,
      })
      throw new RefreshTokenReuseError()
    }

    // La sesión asociada debe existir y no estar revocada (expirada está bien:
    // refresh existe justamente para renovarla)
    const oldSession = await this.sessions.get(rt.sessionId)
    if (!oldSession || oldSession.revokedAt !== undefined) {
      throw new InvalidRefreshTokenError()
    }

    // La cuenta debe seguir ACTIVE (suspendida/baneada pierde acceso ya)
    const account = await this.directory.getUserAccount(rt.userId)
    if (!account) throw new InvalidRefreshTokenError()
    if (account.accountStatus !== 'ACTIVE') {
      throw new AccountNotActiveError(account.accountStatus)
    }

    // Rotación completa: nuevo par
    const token = generateOpaqueToken()
    const sessionId = await hashOpaqueToken(token)
    const issuedAt = now
    const expiresAt = issuedAt + this.accessTokenTtlMs

    const newSession: SessionRecord = {
      id: sessionId,
      userId: rt.userId,
      deviceFingerprint: oldSession.deviceFingerprint,
      issuedAt,
      expiresAt,
      lastSeenAt: issuedAt,
      riskSnapshot: oldSession.riskSnapshot,
    }
    await this.sessions.save(newSession)

    const newRefreshToken = generateOpaqueToken()
    const newRtHash = await hashOpaqueToken(newRefreshToken)
    await this.refreshTokens.save({
      id: newRtHash,
      userId: rt.userId,
      sessionId,
      issuedAt,
      expiresAt: issuedAt + this.refreshTokenTtlMs,
    })

    // Lineage: RT viejo consumido; sesión vieja revocada
    await this.refreshTokens.save({ ...rt, consumedAt: now, rotatedToHash: newRtHash })
    await this.revokeSession(oldSession, 'rotated')

    this.events.emit({
      name: AUTH_EVENTS.TOKEN_REFRESHED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'session', entityId: rt.userId },
      payload: { userId: rt.userId, sessionId },
      timestamp: now,
    })
    this.events.emit({
      name: AUTH_EVENTS.SESSION_ISSUED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'session', entityId: rt.userId },
      payload: {
        userId: rt.userId,
        sessionId,
        deviceFingerprint: newSession.deviceFingerprint,
        expiresAt,
      },
      timestamp: now,
    })

    return {
      userId: rt.userId,
      session: { ...toSessionInfo(newSession), token },
      refreshToken: newRefreshToken,
    }
  }

  /**
   * Solicita un reset de contraseña self-service (ADR-0009).
   * Anti-enumeración: idéntica respuesta exista o no la cuenta; se genera y
   * hashea el token en ambos caminos para igualar el trabajo criptográfico.
   * Requiere `context.email`.
   */
  async requestPasswordReset(identifier: string): Promise<void> {
    if (!this.resetTokens || !this.events) throw new Error('Not Initialized')
    if (!this.emailDelivery) {
      throw new Error(
        "AuthenticationModule requiere 'context.email' (EmailDelivery) para el reset de contraseña. Ver docs/contracts/authentication.md"
      )
    }

    const entry = await this.directory.lookupUser(identifier)

    // Trabajo criptográfico en ambos caminos (mitigación parcial de timing)
    const tokenValue = generateOpaqueToken()
    const tokenHash = await hashOpaqueToken(tokenValue)
    const now = Date.now()

    if (entry) {
      // Invalidar tokens de reset activos anteriores (single active token)
      const all = await this.resetTokens.list()
      for (const t of all) {
        if (t.userId === entry.userId && !t.consumedAt && !t.invalidatedAt) {
          await this.resetTokens.save({ ...t, invalidatedAt: now })
        }
      }

      await this.resetTokens.save({
        id: tokenHash,
        userId: entry.userId,
        createdAt: now,
        expiresAt: now + this.resetTokenTtlMs,
      })

      await this.emailDelivery.send({
        to: entry.email,
        subject: 'Restablece tu contraseña en MorningStar',
        body:
          `Hola ${entry.userId},\n\n` +
          `Recibimos una solicitud para restablecer tu contraseña. Usa el siguiente enlace:\n` +
          `${PASSWORD_RESET_LINK_BASE}?token=${tokenValue}\n\n` +
          `Este enlace es de un solo uso y expira en ${Math.round(this.resetTokenTtlMs / 3_600_000)} hora(s). ` +
          `Si no solicitaste el cambio, ignora este email.\n\n— MorningStar`,
      })
    }

    this.events.emit({
      name: AUTH_EVENTS.PASSWORD_RESET_REQUESTED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'credentials', entityId: entry?.userId },
      payload: entry ? { userId: entry.userId } : {},
      timestamp: Date.now(),
    })
  }

  /**
   * Consume un token de reset y establece la nueva contraseña (ADR-0009):
   * single-use, expiración, invalidación por solicitudes nuevas. Revoca
   * TODAS las sesiones del usuario (posible cuenta comprometida).
   */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!this.credentials || !this.resetTokens || !this.events) throw new Error('Not Initialized')

    const record = await this.resetTokens.get(await hashOpaqueToken(token))
    if (!record) throw new InvalidResetTokenError()

    const now = Date.now()
    if (record.consumedAt !== undefined) throw new ResetTokenAlreadyUsedError()
    if (record.invalidatedAt !== undefined) throw new ResetTokenInvalidatedError()
    if (now > record.expiresAt) throw new ResetTokenExpiredError()

    // Política ANTES de consumir: una contraseña inválida no quema el token
    validatePassword(newPassword, this.passwordPolicy)

    // Consumir antes de los efectos de dominio (single-use estricto)
    await this.resetTokens.save({ ...record, consumedAt: now })

    const existing = await this.credentials.get(record.userId)
    await this.credentials.save({
      id: record.userId,
      passwordHash: await this.hasher.hash(newPassword),
      failedAttempts: 0,
      lockedUntil: undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })

    const sessionsRevoked = await this.revokeUserSessions(record.userId, 'password-reset')

    this.events.emit({
      name: AUTH_EVENTS.PASSWORD_RESET,
      category: 'domain',
      source: { moduleId: this.id, entity: 'credentials', entityId: record.userId },
      payload: { userId: record.userId, sessionsRevoked },
      timestamp: Date.now(),
    })
  }

  /**
   * Segundo factor del login (ADR-0010): consume el challenge emitido por
   * `login` cuando la cuenta tiene MFA activo. Acepta código TOTP (con
   * anti-replay por step) o backup code (hash one-way, consumo individual).
   *
   * Intentos: hasta `maxAttempts` por challenge; al agotarse, el challenge
   * muere (nuevo login requerido). Los fallos de código NO alimentan el
   * lockout de contraseña (contadores separados).
   */
  async completeMfaLogin(mfaToken: string, code: string): Promise<LoginResult> {
    if (!this.sessions || !this.refreshTokens || !this.mfaRecords || !this.mfaChallenges || !this.events) {
      throw new Error('Not Initialized')
    }

    const challenge = await this.mfaChallenges.get(await hashOpaqueToken(mfaToken))
    const now = Date.now()
    if (!challenge || challenge.consumedAt !== undefined || now > challenge.expiresAt) {
      throw new InvalidMfaChallengeError()
    }

    const account = await this.directory.getUserAccount(challenge.userId)
    if (!account) throw new InvalidMfaChallengeError()
    if (account.accountStatus !== 'ACTIVE') {
      throw new AccountNotActiveError(account.accountStatus)
    }

    const mfa = await this.mfaRecords.get(challenge.userId)
    if (!mfa || mfa.status !== 'active' || !mfa.secret) {
      throw new InvalidMfaChallengeError()
    }

    // 1) TOTP con anti-replay (el step debe ser posterior al último aceptado).
    //    El reloj lo aporta el TotpService (inyectable en tests — ADR-0010).
    let updatedMfa: MfaRecord | null = null
    const matchedStep = await this.totp.verifyCode(mfa.secret, code)
    if (matchedStep !== null && (mfa.lastAcceptedStep === undefined || matchedStep > mfa.lastAcceptedStep)) {
      updatedMfa = { ...mfa, lastAcceptedStep: matchedStep, updatedAt: now }
    }

    // 2) Backup code: hash one-way, consumo individual
    if (!updatedMfa) {
      const codeHash = await hashOpaqueToken(normalizeBackupCode(code))
      const hashes = mfa.backupCodeHashes ?? []
      const index = hashes.indexOf(codeHash)
      if (index !== -1) {
        updatedMfa = {
          ...mfa,
          backupCodeHashes: hashes.filter((_, i) => i !== index),
          updatedAt: now,
        }
      }
    }

    if (!updatedMfa) {
      const attempts = challenge.attempts + 1
      await this.mfaChallenges.save(
        attempts >= this.mfaMaxAttempts
          ? { ...challenge, attempts, consumedAt: now } // intentos agotados: el challenge muere
          : { ...challenge, attempts }
      )
      this.events.emit({
        name: AUTH_EVENTS.LOGIN_FAILED,
        category: 'domain',
        source: { moduleId: this.id, entity: 'session', entityId: challenge.userId },
        payload: { userId: challenge.userId, reason: 'invalid-mfa-code' },
        timestamp: now,
      })
      throw new InvalidMfaCodeError()
    }

    // Éxito: consumir challenge (single-use), persistir estado MFA y emitir par
    await this.mfaRecords.save(updatedMfa)
    await this.mfaChallenges.save({ ...challenge, consumedAt: now })

    return this.issueSession(challenge.userId, challenge.deviceFingerprint, now)
  }

  /** Inicia el enrolamiento MFA: genera secret y URI otpauth:// (PENDING). */
  async enrollMfa(userId: string): Promise<MfaEnrollment> {
    if (!this.mfaRecords || !this.events) throw new Error('Not Initialized')

    const account = await this.directory.getUserAccount(userId)
    if (!account) throw new UnknownUserError(userId)

    const existing = await this.mfaRecords.get(userId)
    if (existing?.status === 'active') throw new MfaAlreadyActiveError()

    const secret = this.totp.generateSecret()
    const now = Date.now()
    await this.mfaRecords.save({
      id: userId,
      status: 'pending',
      pendingSecret: secret, // re-enrolamiento pisa el pending anterior
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    })

    this.events.emit({
      name: AUTH_EVENTS.MFA_ENROLLMENT_STARTED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'credentials', entityId: userId },
      payload: { userId },
      timestamp: now,
    })

    return {
      secret, // se muestra UNA sola vez
      otpauthUri: this.totp.generateTotpUri(secret, account.email),
    }
  }

  /** Confirma el enrolamiento con un código válido y activa MFA + backup codes. */
  async confirmMfa(userId: string, code: string): Promise<MfaActivation> {
    if (!this.mfaRecords || !this.events) throw new Error('Not Initialized')

    const record = await this.mfaRecords.get(userId)
    if (!record || record.status !== 'pending' || !record.pendingSecret) {
      throw new MfaNotEnrolledError()
    }

    const now = Date.now()
    const step = await this.totp.verifyCode(record.pendingSecret, code)
    if (step === null) throw new InvalidMfaCodeError()

    const backupCodes = generateBackupCodes(MFA_CHALLENGE_DEFAULTS.backupCodes)
    const backupCodeHashes = await Promise.all(
      backupCodes.map((backupCode) => hashOpaqueToken(normalizeBackupCode(backupCode)))
    )

    await this.mfaRecords.save({
      id: userId,
      status: 'active',
      secret: record.pendingSecret,
      lastAcceptedStep: step,
      backupCodeHashes,
      createdAt: record.createdAt,
      updatedAt: now,
    })

    this.events.emit({
      name: AUTH_EVENTS.MFA_ACTIVATED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'credentials', entityId: userId },
      payload: { userId },
      timestamp: now,
    })

    return { backupCodes } // se muestran UNA sola vez
  }

  /** Desactiva MFA exigiendo un factor válido (TOTP o backup code). */
  async disableMfa(userId: string, code: string): Promise<void> {
    if (!this.mfaRecords || !this.events) throw new Error('Not Initialized')

    const record = await this.mfaRecords.get(userId)
    if (!record || record.status !== 'active' || !record.secret) {
      throw new MfaNotEnrolledError()
    }

    const now = Date.now()
    const step = await this.totp.verifyCode(record.secret, code)
    const totpOk =
      step !== null && (record.lastAcceptedStep === undefined || step > record.lastAcceptedStep)

    let backupOk = false
    if (!totpOk) {
      const codeHash = await hashOpaqueToken(normalizeBackupCode(code))
      backupOk = (record.backupCodeHashes ?? []).includes(codeHash)
    }

    if (!totpOk && !backupOk) throw new InvalidMfaCodeError()

    await this.mfaRecords.remove(userId)

    this.events.emit({
      name: AUTH_EVENTS.MFA_DISABLED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'credentials', entityId: userId },
      payload: { userId },
      timestamp: now,
    })
  }

  /** Estado MFA para la UI (no revela secrets). */
  async getMfaStatus(userId: string): Promise<MfaStatus> {
    if (!this.mfaRecords) throw new Error('Not Initialized')
    const record = await this.mfaRecords.get(userId)
    return {
      enrolled: record !== null,
      active: record?.status === 'active',
    }
  }

  /**
   * Emite el par sesión + refresh token (ADR-0008/0009).
   * Compartido por `login` y `completeMfaLogin`.
   */
  private async issueSession(
    userId: string,
    deviceFingerprint: string,
    now: number
  ): Promise<LoginResult> {
    const token = generateOpaqueToken()
    const sessionId = await hashOpaqueToken(token)
    const issuedAt = now
    const expiresAt = issuedAt + this.accessTokenTtlMs

    const sessionRecord: SessionRecord = {
      id: sessionId,
      userId,
      deviceFingerprint,
      issuedAt,
      expiresAt,
      lastSeenAt: issuedAt,
      riskSnapshot: { riskLevel: 'UNKNOWN' }, // Fase 8 (Risk Engine) lo poblará
    }
    await this.sessions!.save(sessionRecord)

    const refreshToken = generateOpaqueToken()
    await this.refreshTokens!.save({
      id: await hashOpaqueToken(refreshToken),
      userId,
      sessionId,
      issuedAt,
      expiresAt: issuedAt + this.refreshTokenTtlMs,
    })

    this.events!.emit({
      name: AUTH_EVENTS.LOGIN_SUCCEEDED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'session', entityId: userId },
      payload: { userId },
      timestamp: now,
    })

    this.events!.emit({
      name: AUTH_EVENTS.SESSION_ISSUED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'session', entityId: userId },
      payload: { userId, sessionId, deviceFingerprint, expiresAt },
      timestamp: now,
    })

    return {
      userId,
      session: { ...toSessionInfo(sessionRecord), token },
      refreshToken,
    }
  }

  private dummyHash(): Promise<string> {
    this.dummyHashPromise ??= this.hasher.hash('dummy-password-for-timing-equalization')
    return this.dummyHashPromise
  }
}
