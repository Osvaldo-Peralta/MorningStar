// identity/IdentityModule.ts
import { ModuleState } from '@morningstar/core'
import type { AppModule, CoreContext, EmailDelivery, Repository } from '@morningstar/core'
import type { PersistedRecord } from '@morningstar/core'
import { nanoid } from 'nanoid'
import { AccountStatus } from './domain/AccountStatus.js'
import { AccountType } from './domain/AccountType.js'
import { User } from './domain/User.js'
import type { UserRecord, VerificationFlags } from './domain/UserRecord.js'
import type {
  EmailIndexRecord,
  EmailVerificationTokenRecord,
} from './domain/EmailVerificationTokenRecord.js'
import { validateUsername, normalizeUsername } from './domain/usernamePolicy.js'
import { validateDisplayName } from './domain/displayNamePolicy.js'
import { validateEmail, normalizeEmail } from './domain/emailPolicy.js'
import { generateTokenValue, hashToken } from './domain/tokenUtils.js'
import {
  EmailAlreadyRegisteredError,
  InvalidVerificationTokenError,
  TokenAlreadyUsedError,
  TokenExpiredError,
  TokenInvalidatedError,
  UserNotFoundError,
  UsernameAlreadyTakenError,
} from './errors.js'
import { IDENTITY_EVENTS } from './events.js'

/** Namespaces del módulo (ADR-0002/0003: `<modulo>:<recurso>`). */
const USERS_NAMESPACE = 'identity:users'
const USERNAME_INDEX_NAMESPACE = 'identity:usernames'
const EMAIL_INDEX_NAMESPACE = 'identity:emails'
const EMAIL_TOKENS_NAMESPACE = 'identity:email-tokens'

/** TTL por defecto de los tokens de verificación (ADR-0006). */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000 // 24 horas

/** Base del enlace de verificación (placeholder hasta que exista la app pública). */
export const VERIFICATION_LINK_BASE = 'https://morningstar.app/verify-email'

export interface IdentityModuleOptions {
  /** TTL de los tokens de verificación. Default: 24 h. Inyectable para tests. */
  readonly tokenTtlMs?: number
}

/** Registro del índice de unicidad de usernames: username normalizado → userId. */
interface UsernameIndexRecord extends PersistedRecord {
  readonly userId: string
}

/**
 * Modelo de lectura público: datos planos de solo lectura.
 * El agregado `User` NO se expone a consumidores (Baseline v1.0 menciona
 * "internal flags": el snapshot es la frontera que los protege).
 */
export interface UserSnapshot {
  readonly id: string
  readonly username: string
  readonly email: string
  readonly displayName: string
  readonly accountType: AccountType
  readonly accountStatus: AccountStatus
  readonly verificationFlags: VerificationFlags
  readonly createdAt: number
  readonly updatedAt: number
}

export interface RegisterUserInput {
  readonly username: string
  readonly email: string
  readonly displayName: string
  /** Default: PERSONAL (Baseline v1.0 §1). */
  readonly accountType?: AccountType
}

function toSnapshot(user: User): UserSnapshot {
  const record = user.toRecord()
  return {
    id: record.id,
    username: record.username,
    email: record.email,
    displayName: record.displayName,
    accountType: record.accountType,
    accountStatus: record.accountStatus,
    verificationFlags: record.verificationFlags,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/**
 * Módulo de identidad (Fase 3, Baseline v1.0 §1).
 *
 * Gestiona el agregado User como dominio independiente de authentication y
 * authorization, incluyendo el ciclo de vida del EmailVerificationToken
 * (ADR-0006): generated per request, single-use, expires, invalidates
 * previous active tokens, does not change account status if SUSPENDED.
 *
 * Requiere `context.persistence` (camino único, ADR-0003). Los flujos de
 * verificación requieren además `context.email` (EmailDelivery).
 *
 * "Re-auth required for sensitive changes" (Baseline): los comandos sensibles
 * aceptarán el contexto de actor cuando exista Authentication (Fase 4); la
 * forma del API queda registrada en ADR-0005.
 */
export class IdentityModule implements AppModule {
  readonly id = 'identity'
  readonly version = '0.2.0'

  private readonly tokenTtlMs: number

  private users?: Repository<UserRecord>
  private usernameIndex?: Repository<UsernameIndexRecord>
  private emailIndex?: Repository<EmailIndexRecord>
  private emailTokens?: Repository<EmailVerificationTokenRecord>
  private emailDelivery?: EmailDelivery
  private events?: CoreContext['events']

  state = ModuleState.Registered

  constructor(options: IdentityModuleOptions = {}) {
    this.tokenTtlMs = options.tokenTtlMs ?? EMAIL_VERIFICATION_TTL_MS
  }

  async init(context: CoreContext): Promise<void> {
    if (!context.persistence) {
      throw new Error(
        "IdentityModule requiere 'context.persistence' (PersistenceProvider). Ver docs/contracts/identity.md"
      )
    }

    this.users = context.persistence.repository<UserRecord>(USERS_NAMESPACE)
    this.usernameIndex = context.persistence.repository<UsernameIndexRecord>(USERNAME_INDEX_NAMESPACE)
    this.emailIndex = context.persistence.repository<EmailIndexRecord>(EMAIL_INDEX_NAMESPACE)
    this.emailTokens = context.persistence.repository<EmailVerificationTokenRecord>(EMAIL_TOKENS_NAMESPACE)
    this.emailDelivery = context.email
    this.events = context.events
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async dispose(): Promise<void> {
    this.users = undefined
    this.usernameIndex = undefined
    this.emailIndex = undefined
    this.emailTokens = undefined
    this.emailDelivery = undefined
    this.events = undefined
  }

  /** API pública del módulo */

  async registerUser(input: RegisterUserInput): Promise<UserSnapshot> {
    if (!this.users || !this.usernameIndex || !this.emailIndex || !this.events) {
      throw new Error('Not Initialized')
    }

    // 1. Validaciones de dominio (todo normalizado)
    const username = validateUsername(input.username)
    const email = validateEmail(input.email)
    const displayName = validateDisplayName(input.displayName)
    const accountType = input.accountType ?? AccountType.Personal

    // 2. Unicidad case-insensitive vía índices (O(1), sin escanear usuarios)
    if (await this.usernameIndex.get(username)) {
      throw new UsernameAlreadyTakenError(username)
    }
    if (await this.emailIndex.get(email)) {
      throw new EmailAlreadyRegisteredError(email)
    }

    // 3. Agregado + persistencia (usuario → índices; ver ADR-0005 §3)
    const user = User.create({ id: nanoid(), username, email, displayName, accountType })
    await this.users.save(user.toRecord())
    await this.usernameIndex.save({ id: username, userId: user.id })
    await this.emailIndex.save({ id: email, userId: user.id })

    // 4. Evento de dominio
    this.events.emit({
      name: IDENTITY_EVENTS.REGISTERED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'user', entityId: user.id },
      payload: {
        userId: user.id,
        username: user.username,
        accountType: user.accountType,
        accountStatus: user.accountStatus,
      },
      timestamp: Date.now(),
    })

    return toSnapshot(user)
  }

  async changeStatus(userId: string, to: AccountStatus, reason?: string): Promise<UserSnapshot> {
    const user = await this.requireUser(userId)

    const from = user.changeStatus(to) // lanza InvalidStatusTransitionError si la política lo rechaza
    await this.users!.save(user.toRecord())

    this.events!.emit({
      name: IDENTITY_EVENTS.STATUS_CHANGED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'user', entityId: userId },
      payload: { userId, from, to, reason },
      timestamp: Date.now(),
    })

    return toSnapshot(user)
  }

  async updateDisplayName(userId: string, displayName: string): Promise<UserSnapshot> {
    const user = await this.requireUser(userId)

    user.updateDisplayName(displayName)
    await this.users!.save(user.toRecord())

    this.events!.emit({
      name: IDENTITY_EVENTS.PROFILE_UPDATED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'user', entityId: userId },
      payload: { userId, displayName: user.displayName },
      timestamp: Date.now(),
    })

    return toSnapshot(user)
  }

  async changeAccountType(userId: string, to: AccountType): Promise<UserSnapshot> {
    const user = await this.requireUser(userId)

    const from = user.changeAccountType(to) // lanza InvalidAccountTypeConversionError
    await this.users!.save(user.toRecord())

    this.events!.emit({
      name: IDENTITY_EVENTS.TYPE_CHANGED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'user', entityId: userId },
      payload: { userId, from, to },
      timestamp: Date.now(),
    })

    return toSnapshot(user)
  }

  /**
   * Solicita un token de verificación (Baseline: "Generated per request",
   * "Invalidates previous active tokens"). Requiere `context.email`.
   */
  async requestEmailVerification(userId: string): Promise<void> {
    if (!this.users || !this.emailTokens || !this.events) throw new Error('Not Initialized')
    if (!this.emailDelivery) {
      throw new Error(
        "IdentityModule requiere 'context.email' (EmailDelivery) para la verificación. Ver docs/contracts/identity.md"
      )
    }

    const user = await this.requireUser(userId)
    const now = Date.now()

    // Invalidar tokens activos anteriores del usuario (single active token)
    const allTokens = await this.emailTokens.list()
    for (const token of allTokens) {
      if (token.userId === userId && !token.consumedAt && !token.invalidatedAt) {
        await this.emailTokens.save({ ...token, invalidatedAt: now })
      }
    }

    const tokenValue = generateTokenValue()
    const record: EmailVerificationTokenRecord = {
      id: await hashToken(tokenValue), // el claro nunca se persiste (ADR-0006)
      userId,
      email: user.email,
      createdAt: now,
      expiresAt: now + this.tokenTtlMs,
    }
    await this.emailTokens.save(record)

    await this.emailDelivery.send({
      to: user.email,
      subject: 'Verifica tu email en MorningStar',
      body:
        `Hola ${user.displayName},\n\n` +
        `Verifica tu email usando el siguiente enlace:\n` +
        `${VERIFICATION_LINK_BASE}?token=${tokenValue}\n\n` +
        `Este enlace es de un solo uso y expira en ${Math.round(this.tokenTtlMs / 3_600_000)} horas.\n\n` +
        `— MorningStar`,
    })

    this.events.emit({
      name: IDENTITY_EVENTS.VERIFICATION_REQUESTED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'user', entityId: userId },
      payload: { userId, email: user.email, expiresAt: record.expiresAt },
      timestamp: Date.now(),
    })
  }

  /**
   * Confirma el email con el token recibido (Baseline: "VERIFIED occurs upon
   * email confirmation", "Does not change account status if SUSPENDED").
   *
   * Reglas: single-use, expiración, invalidación por solicitudes nuevas.
   * Solo PENDING_VERIFICATION transiciona a ACTIVE; cualquier otro estado
   * conserva su status (el flag emailVerified sí se marca).
   */
  async confirmEmail(token: string): Promise<UserSnapshot> {
    if (!this.users || !this.emailTokens || !this.events) throw new Error('Not Initialized')

    const record = await this.emailTokens.get(await hashToken(token))
    if (!record) throw new InvalidVerificationTokenError()

    const now = Date.now()
    if (record.consumedAt) throw new TokenAlreadyUsedError()
    if (record.invalidatedAt) throw new TokenInvalidatedError()
    if (now > record.expiresAt) throw new TokenExpiredError()

    // 1. Consumir el token ANTES de los efectos de dominio (single-use estricto)
    await this.emailTokens.save({ ...record, consumedAt: now })

    // 2. Marcar verificado; transición solo desde PENDING_VERIFICATION
    const user = await this.requireUser(record.userId)
    user.markEmailVerified()

    let statusChanged: { from: AccountStatus; to: AccountStatus } | undefined
    if (user.accountStatus === AccountStatus.PendingVerification) {
      const from = user.changeStatus(AccountStatus.Active)
      statusChanged = { from, to: AccountStatus.Active }
    }
    // SUSPENDED (y demás estados): el flag se marca, el estado NO cambia (Baseline)

    await this.users.save(user.toRecord())

    // 3. Eventos: status-changed (si aplicó) y email-verified
    if (statusChanged) {
      this.events.emit({
        name: IDENTITY_EVENTS.STATUS_CHANGED,
        category: 'domain',
        source: { moduleId: this.id, entity: 'user', entityId: user.id },
        payload: {
          userId: user.id,
          from: statusChanged.from,
          to: statusChanged.to,
          reason: 'email confirmed',
        },
        timestamp: Date.now(),
      })
    }

    this.events.emit({
      name: IDENTITY_EVENTS.EMAIL_VERIFIED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'user', entityId: user.id },
      payload: { userId: user.id, email: record.email },
      timestamp: Date.now(),
    })

    return toSnapshot(user)
  }

  async getUser(userId: string): Promise<UserSnapshot | null> {
    if (!this.users) throw new Error('Not Initialized')
    const record = await this.users.get(userId)
    return record ? toSnapshot(User.fromRecord(record)) : null
  }

  /** Búsqueda case-insensitive: normaliza y resuelve vía índice. */
  async getByUsername(username: string): Promise<UserSnapshot | null> {
    if (!this.users || !this.usernameIndex) throw new Error('Not Initialized')
    const indexEntry = await this.usernameIndex.get(normalizeUsername(username))
    if (!indexEntry) return null
    return this.getUser(indexEntry.userId)
  }

  /** Búsqueda case-insensitive de email: normaliza y resuelve vía índice (ADR-0006). */
  async getByEmail(email: string): Promise<UserSnapshot | null> {
    if (!this.users || !this.emailIndex) throw new Error('Not Initialized')
    const indexEntry = await this.emailIndex.get(normalizeEmail(email))
    if (!indexEntry) return null
    return this.getUser(indexEntry.userId)
  }

  async listUsers(): Promise<UserSnapshot[]> {
    if (!this.users) throw new Error('Not Initialized')
    const records = await this.users.list()
    return records.map((record) => toSnapshot(User.fromRecord(record)))
  }

  private async requireUser(userId: string): Promise<User> {
    if (!this.users || !this.events) throw new Error('Not Initialized')
    const record = await this.users.get(userId)
    if (!record) {
      throw new UserNotFoundError(userId)
    }
    return User.fromRecord(record)
  }
}
