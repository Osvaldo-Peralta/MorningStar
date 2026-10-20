// messaging/MessagingEventMap.ts
import type {
  ConversationCreatedPayload,
  MessageSentPayload,
  MessageEditedPayload,
  MessageDeletedPayload,
} from './events.js'

/**
 * Mapa de eventos del módulo Messaging.
 * Se expone como contrato público del módulo.
 */
export interface MessagingEventMap {
  'msg:conversation-created': ConversationCreatedPayload;
  'msg:sent': MessageSentPayload;
  'msg:edited': MessageEditedPayload;
  'msg:deleted': MessageDeletedPayload;
}

/**
 * Module augmentation: el módulo aporta sus eventos al contrato del Core
 * (patrón ADR-0001/0002: la dependencia va solo messaging → core).
 */
declare module '@morningstar/core' {
  interface CoreEventMap {
    'msg:conversation-created': ConversationCreatedPayload;
    'msg:sent': MessageSentPayload;
    'msg:edited': MessageEditedPayload;
    'msg:deleted': MessageDeletedPayload;
  }
}
