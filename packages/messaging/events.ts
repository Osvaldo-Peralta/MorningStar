// messaging/events.ts
// Payloads de los eventos de dominio del módulo (prefijo `msg:`, ADR-0001:
// v1 implícita, evolución solo aditiva).
import type { ConversationKind } from './domain/ConversationRecord.js'

export const MSG_EVENTS = {
  CONVERSATION_CREATED: 'msg:conversation-created',
  MESSAGE_SENT: 'msg:sent',
  MESSAGE_EDITED: 'msg:edited',
  MESSAGE_DELETED: 'msg:deleted',
} as const

export interface ConversationCreatedPayload {
  readonly conversationId: string
  readonly kind: ConversationKind
  readonly participantIds: readonly string[]
  /** Ausente en conversaciones directas. */
  readonly title?: string
  readonly createdBy: string
  readonly createdAt: number
}

export interface MessageSentPayload {
  readonly messageId: string
  readonly conversationId: string
  readonly authorId: string
  readonly seq: number
  /** Cuerpo del mensaje: los consumidores de UI lo usan para render en vivo. */
  readonly body: string
  readonly createdAt: number
}

export interface MessageEditedPayload {
  readonly messageId: string
  readonly conversationId: string
  readonly authorId: string
  /** Cuerpo nuevo (post-edición). */
  readonly body: string
  readonly editedAt: number
}

export interface MessageDeletedPayload {
  readonly messageId: string
  readonly conversationId: string
  /** Autor del borrado: el propio autor o un moderador (ADR-0015). */
  readonly deletedBy: string
  readonly deletedAt: number
}
