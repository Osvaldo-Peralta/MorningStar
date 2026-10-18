// identity/IdentityModule.ts
import { ModuleState } from '@morningstar/core'
import type { AppModule, CoreContext, Repository } from '@morningstar/core'
import type { PersistedRecord } from '@morningstar/core'
import { nanoid } from 'nanoid'
import { AccountType } from './domain/AccountType.js'
import type { AccountStatus } from './domain/AccountStatus.js'
import { User } from './domain/User.js'
import type { UserRecord, VerificationFlags } from './domain/UserRecord.js'
import { validateUsername, normalizeUsername } from './domain/usernamePolicy.js'
import { validateDisplayName } from './domain/displayNamePolicy.js'
import { UserNotFoundError, UsernameAlreadyTakenError } from './errors.js'
import { IDENTITY_EVENTS } from './events.js'

/** Namespaces del módulo (ADR-0002/0003: `<modulo>:<recurso>`). */
const USERS_NAMESPACE = 'identity:users'
const USERNAME_INDEX_NAMESPACE = 'identity:usernames'

/** Registro del índice de unicidad: username normalizado → userId. */
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
  readonly displayName: string
  readonly accountType: AccountType
  readonly accountStatus: AccountStatus
  readonly verificationFlags: VerificationFlags
  readonly createdAt: number
  readonly updatedAt: number
}

export interface RegisterUserInput {
  readonly username: string
  readonly displayName: string
  /** Default: PERSONAL (Baseline v1.0 §1). */
  readonly accountType?: AccountType
}

function toSnapshot(user: User): UserSnapshot {
  const record = user.toRecord()
  return {
    id: record.id,
    username: record.username,
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
 * authorization. Requiere `context.persistence` (camino único, ADR-0003).
 *
 * "Re-auth required for sensitive changes" (Baseline): los comandos sensibles
 * aceptarán el contexto de actor cuando exista Authentication (Fase 4); la
 * forma del API queda registrada en ADR-0005.
 */
export class IdentityModule implements AppModule {
  readonly id = 'identity'
  readonly version = '0.1.0'

  private users?: Repository<UserRecord>
  private usernameIndex?: Repository<UsernameIndexRecord>
  private events?: CoreContext['events']

  state = ModuleState.Registered

  async init(context: CoreContext): Promise<void> {
    if (!context.persistence) {
      throw new Error(
        "IdentityModule requiere 'context.persistence' (PersistenceProvider). Ver docs/contracts/identity.md"
      )
    }

    this.users = context.persistence.repository<UserRecord>(USERS_NAMESPACE)
    this.usernameIndex = context.persistence.repository<UsernameIndexRecord>(USERNAME_INDEX_NAMESPACE)
    this.events = context.events
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async dispose(): Promise<void> {
    this.users = undefined
    this.usernameIndex = undefined
    this.events = undefined
  }

  /** API pública del módulo */

  async registerUser(input: RegisterUserInput): Promise<UserSnapshot> {
    if (!this.users || !this.usernameIndex || !this.events) throw new Error('Not Initialized')

    // 1. Validaciones de dominio (username normalizado + displayName)
    const username = validateUsername(input.username)
    const displayName = validateDisplayName(input.displayName)
    const accountType = input.accountType ?? AccountType.Personal

    // 2. Unicidad case-insensitive vía índice (O(1), sin escanear usuarios)
    const taken = await this.usernameIndex.get(username)
    if (taken) {
      throw new UsernameAlreadyTakenError(username)
    }

    // 3. Agregado + persistencia (usuario e índice)
    const user = User.create({ id: nanoid(), username, displayName, accountType })
    await this.users.save(user.toRecord())
    await this.usernameIndex.save({ id: username, userId: user.id })

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
