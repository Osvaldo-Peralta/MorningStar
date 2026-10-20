// messaging/domain/Message.ts
import type { MessageRecord } from './MessageRecord.js'
import type { MessagingPolicy } from './messagingPolicy.js'
import {
  InvalidMessageBodyError,
  MessageAlreadyDeletedError,
  MessagingError,
} from '../errors.js'

export interface MessageInfo {
  readonly messageId: string
  readonly conversationId: string
  readonly authorId: string
  /** Orden determinista dentro de la conversación (1-based). */
  readonly seq: number
  /** `''` en mensajes eliminados (tombstone): el cuerpo no sobrevive al borrado. */
  readonly body: string
  readonly createdAt: number
  readonly editedAt?: number
  readonly deletedAt?: number
}

export interface CreateMessageInput {
  readonly id: string
  readonly conversationId: string
  readonly authorId: string
  readonly seq: number
  readonly body: string
}

/**
 * Agregado Message (módulo messaging, Fase 6).
 *
 * Privados reales `#` (convención del proyecto). Ciclo de vida:
 * - create: valida el cuerpo contra la política (trim, 1..maxBodyLength).
 * - edit: solo sobre mensajes vivos; `editedAt` marca la última edición (no
 *   se conserva historial — deuda registrada si alguna vez se necesita).
 * - delete: **soft delete** (tombstone, ADR-0015): preserva la continuidad
 *   de la conversación y vacía el cuerpo (privacidad: el texto no sobrevive).
 *
 * La autoría (quién puede editar/borrar) se enforcea en el módulo con el
 * Authorizer + invariantes de dominio; el agregado no conoce actores.
 */
export class Message {
  readonly id: string
  readonly conversationId: string
  readonly authorId: string
  readonly seq: number
  #body: string
  #createdAt: number
  #editedAt: number | undefined
  #deletedAt: number | undefined

  private constructor(
    id: string,
    conversationId: string,
    authorId: string,
    seq: number,
    body: string,
    createdAt: number,
    editedAt: number | undefined,
    deletedAt: number | undefined
  ) {
    this.id = id
    this.conversationId = conversationId
    this.authorId = authorId
    this.seq = seq
    this.#body = body
    this.#createdAt = createdAt
    this.#editedAt = editedAt
    this.#deletedAt = deletedAt
  }

  static create(input: CreateMessageInput, policy: MessagingPolicy): Message {
    const body = Message.validateBody(input.body, policy)
    if (!input.authorId || input.authorId.trim() === '') {
      throw new MessagingError('authorId is required')
    }
    if (!Number.isInteger(input.seq) || input.seq < 1) {
      throw new MessagingError('seq must be a positive integer')
    }
    return new Message(input.id, input.conversationId, input.authorId, input.seq, body, Date.now(), undefined, undefined)
  }

  static fromRecord(record: MessageRecord): Message {
    return new Message(
      record.id,
      record.conversationId,
      record.authorId,
      record.seq,
      record.body,
      record.createdAt,
      record.editedAt,
      record.deletedAt
    )
  }

  static validateBody(body: unknown, policy: MessagingPolicy): string {
    if (typeof body !== 'string') {
      throw new InvalidMessageBodyError('body must be a string')
    }
    const trimmed = body.trim()
    if (trimmed === '') {
      throw new InvalidMessageBodyError('body cannot be empty')
    }
    if (trimmed.length > policy.maxBodyLength) {
      throw new InvalidMessageBodyError(
        `body must have at most ${policy.maxBodyLength} characters`
      )
    }
    return trimmed
  }

  get body(): string {
    return this.#body
  }

  get createdAt(): number {
    return this.#createdAt
  }

  get editedAt(): number | undefined {
    return this.#editedAt
  }

  get deletedAt(): number | undefined {
    return this.#deletedAt
  }

  get isDeleted(): boolean {
    return this.#deletedAt !== undefined
  }

  /**
   * Edita el cuerpo. Devuelve `false` si el cuerpo es idéntico (sin cambios
   * reales ⇒ el módulo no emite evento, clean logic como photo-feed).
   */
  edit(newBody: string, policy: MessagingPolicy): boolean {
    if (this.#deletedAt !== undefined) {
      throw new MessageAlreadyDeletedError(this.id)
    }
    const body = Message.validateBody(newBody, policy)
    if (body === this.#body) return false
    this.#body = body
    this.#editedAt = Date.now()
    return true
  }

  /** Soft delete: tombstone + cuerpo vaciado (el texto no sobrevive). */
  delete(): void {
    if (this.#deletedAt !== undefined) {
      throw new MessageAlreadyDeletedError(this.id)
    }
    this.#deletedAt = Date.now()
    this.#body = ''
  }

  toRecord(): MessageRecord {
    const base: MessageRecord = {
      id: this.id,
      conversationId: this.conversationId,
      authorId: this.authorId,
      seq: this.seq,
      body: this.#body,
      createdAt: this.#createdAt,
    }
    const edited = this.#editedAt !== undefined ? { editedAt: this.#editedAt } : {}
    const deleted = this.#deletedAt !== undefined ? { deletedAt: this.#deletedAt } : {}
    return { ...base, ...edited, ...deleted }
  }

  toInfo(): MessageInfo {
    const base: MessageInfo = {
      messageId: this.id,
      conversationId: this.conversationId,
      authorId: this.authorId,
      seq: this.seq,
      body: this.#body,
      createdAt: this.#createdAt,
    }
    const edited = this.#editedAt !== undefined ? { editedAt: this.#editedAt } : {}
    const deleted = this.#deletedAt !== undefined ? { deletedAt: this.#deletedAt } : {}
    return { ...base, ...edited, ...deleted }
  }
}
