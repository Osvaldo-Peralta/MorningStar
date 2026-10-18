// identity/domain/User.ts
import type { AccountStatus } from './AccountStatus.js'
import { AccountType } from './AccountType.js'
import { assertTransition } from './StatusTransitionPolicy.js'
import { assertAccountTypeConversion } from './AccountType.js'
import { validateDisplayName } from './displayNamePolicy.js'
import type { UserRecord, VerificationFlags } from './UserRecord.js'

export interface CreateUserInput {
  readonly id: string
  /** Debe venir ya validado y normalizado (validateUsername). */
  readonly username: string
  readonly displayName: string
  readonly accountType?: AccountType
}

/**
 * Agregado User (raíz de dominio del módulo identity — Baseline v1.0 §1).
 *
 * Independiente de authentication y authorization: solo identidad y ciclo de
 * vida de la cuenta. Estado mutable con campos privados reales (`#`);
 * exposición pública mediante getters y snapshots de solo lectura.
 */
export class User {
  readonly id: string
  #username: string
  #displayName: string
  #accountType: AccountType
  #accountStatus: AccountStatus
  #verificationFlags: VerificationFlags
  #createdAt: number
  #updatedAt: number

  private constructor(
    id: string,
    username: string,
    displayName: string,
    accountType: AccountType,
    accountStatus: AccountStatus,
    verificationFlags: VerificationFlags,
    createdAt: number,
    updatedAt: number
  ) {
    this.id = id
    this.#username = username
    this.#displayName = displayName
    this.#accountType = accountType
    this.#accountStatus = accountStatus
    this.#verificationFlags = verificationFlags
    this.#createdAt = createdAt
    this.#updatedAt = updatedAt
  }

  /** Fábrica de registro: toda cuenta nueva nace en PENDING_VERIFICATION. */
  static create(input: CreateUserInput): User {
    const now = Date.now()
    return new User(
      input.id,
      input.username,
      validateDisplayName(input.displayName),
      input.accountType ?? AccountType.Personal,
      'PENDING_VERIFICATION',
      { emailVerified: false },
      now,
      now
    )
  }

  get username(): string {
    return this.#username
  }

  get displayName(): string {
    return this.#displayName
  }

  get accountType(): AccountType {
    return this.#accountType
  }

  get accountStatus(): AccountStatus {
    return this.#accountStatus
  }

  get verificationFlags(): VerificationFlags {
    return this.#verificationFlags
  }

  get createdAt(): number {
    return this.#createdAt
  }

  get updatedAt(): number {
    return this.#updatedAt
  }

  /**
   * Transición de estado validada por StatusTransitionPolicy.
   * Devuelve el estado anterior (para el payload del evento).
   */
  changeStatus(to: AccountStatus): AccountStatus {
    assertTransition(this.#accountStatus, to)
    const from = this.#accountStatus
    this.#accountStatus = to
    this.#updatedAt = Date.now()
    return from
  }

  /** Marca el email como verificado (lo usará confirmEmail, Iteración 5). */
  markEmailVerified(): void {
    this.#verificationFlags = { ...this.#verificationFlags, emailVerified: true }
    this.#updatedAt = Date.now()
  }

  updateDisplayName(displayName: string): string {
    const normalized = validateDisplayName(displayName)
    const previous = this.#displayName
    this.#displayName = normalized
    this.#updatedAt = Date.now()
    return previous
  }

  /** Devuelve el tipo anterior; lanza si la conversión no está permitida. */
  changeAccountType(to: AccountType): AccountType {
    assertAccountTypeConversion(this.#accountType, to)
    const from = this.#accountType
    this.#accountType = to
    this.#updatedAt = Date.now()
    return from
  }

  toRecord(): UserRecord {
    return {
      id: this.id,
      username: this.#username,
      displayName: this.#displayName,
      accountType: this.#accountType,
      accountStatus: this.#accountStatus,
      verificationFlags: { ...this.#verificationFlags },
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
    }
  }

  static fromRecord(record: UserRecord): User {
    return new User(
      record.id,
      record.username,
      record.displayName,
      record.accountType,
      record.accountStatus,
      { ...record.verificationFlags },
      record.createdAt,
      record.updatedAt
    )
  }
}
