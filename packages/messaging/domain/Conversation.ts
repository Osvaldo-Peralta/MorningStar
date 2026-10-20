// messaging/domain/Conversation.ts
import type { ConversationKind, ConversationRecord } from './ConversationRecord.js'
import type { MessagingPolicy } from './messagingPolicy.js'
import { InvalidConversationTitleError, InvalidParticipantsError } from '../errors.js'

export interface ConversationInfo {
  readonly conversationId: string
  readonly kind: ConversationKind
  readonly participantIds: readonly string[]
  readonly title?: string
  readonly createdBy: string
  readonly createdAt: number
  readonly lastMessageAt?: number
}

export interface CreateConversationInput {
  readonly id: string
  readonly kind: ConversationKind
  readonly participantIds: readonly string[]
  readonly title?: string
  readonly createdBy: string
}

/**
 * Agregado Conversation (raíz de dominio del módulo messaging, Fase 6).
 *
 * Estado mutable con privados reales `#` (convención del proyecto): no se
 * filtra al serializar. La lectura expone copias defensivas.
 *
 * Invariantes (ADR-0015):
 * - `direct`: exactamente 2 participantes distintos, sin título.
 * - `group`: entre `minParticipants` y `maxParticipants` participantes
 *   únicos; el creador siempre participa; título opcional acotado.
 * - Los participantes son fijos en v1 (agregar/quitar miembros será aditivo).
 */
export class Conversation {
  readonly id: string
  #kind: ConversationKind
  #participantIds: string[]
  #title: string | undefined
  #createdBy: string
  #createdAt: number
  #lastMessageAt: number | undefined

  private constructor(
    id: string,
    kind: ConversationKind,
    participantIds: string[],
    title: string | undefined,
    createdBy: string,
    createdAt: number,
    lastMessageAt: number | undefined
  ) {
    this.id = id
    this.#kind = kind
    this.#participantIds = participantIds
    this.#title = title
    this.#createdBy = createdBy
    this.#createdAt = createdAt
    this.#lastMessageAt = lastMessageAt
  }

  /** Crea una conversación nueva validando las invariantes del kind. */
  static create(input: CreateConversationInput, policy: MessagingPolicy): Conversation {
    const participantIds = Conversation.validateParticipants(input.participantIds)

    if (input.kind === 'direct') {
      if (participantIds.length !== 2) {
        throw new InvalidParticipantsError('a direct conversation requires exactly 2 participants')
      }
      if (input.title !== undefined) {
        throw new InvalidConversationTitleError('direct conversations cannot have a title')
      }
    } else {
      if (participantIds.length < policy.minParticipants) {
        throw new InvalidParticipantsError(
          `a group conversation requires at least ${policy.minParticipants} participants`
        )
      }
    }

    if (participantIds.length > policy.maxParticipants) {
      throw new InvalidParticipantsError(
        `a conversation cannot have more than ${policy.maxParticipants} participants`
      )
    }

    if (!input.createdBy || !participantIds.includes(input.createdBy)) {
      throw new InvalidParticipantsError('the creator must be a participant')
    }

    const title = Conversation.validateTitle(input.title, input.kind, policy)

    return new Conversation(
      input.id,
      input.kind,
      participantIds,
      title,
      input.createdBy,
      Date.now(),
      undefined
    )
  }

  /** Rehidrata desde el repositorio preservando identidad (ADR-0003). */
  static fromRecord(record: ConversationRecord): Conversation {
    return new Conversation(
      record.id,
      record.kind,
      [...record.participantIds],
      record.title,
      record.createdBy,
      record.createdAt,
      record.lastMessageAt
    )
  }

  private static validateParticipants(participantIds: readonly string[]): string[] {
    if (!Array.isArray(participantIds)) {
      throw new InvalidParticipantsError('participantIds must be an array')
    }
    for (const id of participantIds) {
      if (typeof id !== 'string' || id.trim() === '') {
        throw new InvalidParticipantsError('participant ids must be non-empty strings')
      }
    }
    // Dedup tolerante: [a, a, b] ⇒ [a, b] (la cantidad mínima se valida sobre
    // la lista ya deducida).
    return [...new Set(participantIds.map((id) => id.trim()))]
  }

  private static validateTitle(
    title: string | undefined,
    kind: ConversationKind,
    policy: MessagingPolicy
  ): string | undefined {
    if (title === undefined) return undefined
    if (kind !== 'group') return undefined
    if (typeof title !== 'string') {
      throw new InvalidConversationTitleError('title must be a string')
    }
    const trimmed = title.trim()
    if (trimmed === '') {
      throw new InvalidConversationTitleError('title cannot be empty when provided')
    }
    if (trimmed.length > policy.maxTitleLength) {
      throw new InvalidConversationTitleError(
        `title must have at most ${policy.maxTitleLength} characters`
      )
    }
    return trimmed
  }

  get kind(): ConversationKind {
    return this.#kind
  }

  /** Copia defensiva: mutar el resultado no afecta al agregado. */
  get participantIds(): readonly string[] {
    return [...this.#participantIds]
  }

  get title(): string | undefined {
    return this.#title
  }

  get createdBy(): string {
    return this.#createdBy
  }

  get createdAt(): number {
    return this.#createdAt
  }

  get lastMessageAt(): number | undefined {
    return this.#lastMessageAt
  }

  isParticipant(userId: string): boolean {
    return this.#participantIds.includes(userId)
  }

  /** Marca el timestamp del último mensaje (orden de la lista de conversaciones). */
  touch(lastMessageAt: number): void {
    this.#lastMessageAt = lastMessageAt
  }

  toRecord(): ConversationRecord {
    const base: ConversationRecord = {
      id: this.id,
      kind: this.#kind,
      participantIds: [...this.#participantIds],
      createdBy: this.#createdBy,
      createdAt: this.#createdAt,
    }
    const title = this.#title !== undefined ? { title: this.#title } : {}
    const last = this.#lastMessageAt !== undefined ? { lastMessageAt: this.#lastMessageAt } : {}
    return { ...base, ...title, ...last }
  }

  toInfo(): ConversationInfo {
    const base: ConversationInfo = {
      conversationId: this.id,
      kind: this.#kind,
      participantIds: [...this.#participantIds],
      createdBy: this.#createdBy,
      createdAt: this.#createdAt,
    }
    const title = this.#title !== undefined ? { title: this.#title } : {}
    const last = this.#lastMessageAt !== undefined ? { lastMessageAt: this.#lastMessageAt } : {}
    return { ...base, ...title, ...last }
  }
}
