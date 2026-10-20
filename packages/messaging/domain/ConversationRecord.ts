// messaging/domain/ConversationRecord.ts
import type { PersistedRecord } from '@morningstar/core'

export type ConversationKind = 'direct' | 'group'

/**
 * Proyección plana y serializable de `Conversation` (ADR-0003).
 * Namespace del repositorio: `messaging:conversations`.
 */
export interface ConversationRecord extends PersistedRecord {
  readonly kind: ConversationKind
  readonly participantIds: readonly string[]
  /** Solo en conversaciones grupales. */
  readonly title?: string
  readonly createdBy: string
  readonly createdAt: number
  /** Timestamp del último mensaje (ordenamiento de la lista); ausente si vacía. */
  readonly lastMessageAt?: number
}
