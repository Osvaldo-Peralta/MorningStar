// messaging/domain/MessageRecord.ts
import type { PersistedRecord } from '@morningstar/core'

/**
 * Proyección plana y serializable de `Message` (ADR-0003).
 * Namespace del repositorio: `messaging:messages`.
 *
 * `seq` es monotónico por conversación (1, 2, 3…): da orden determinista a
 * la paginación incluso con `createdAt` empatados (mismo milisegundo) y tras
 * rehidratar (el orden de `list()` del repositorio no está garantizado).
 */
export interface MessageRecord extends PersistedRecord {
  readonly conversationId: string
  readonly authorId: string
  readonly seq: number
  /** Cuerpo del mensaje; `''` en mensajes eliminados (tombstone). */
  readonly body: string
  readonly createdAt: number
  readonly editedAt?: number
  readonly deletedAt?: number
}
