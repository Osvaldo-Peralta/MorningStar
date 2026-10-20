// messaging/errors.ts
// Jerarquía de errores del módulo Messaging. `name` estable en todos
// (filtrable en logs/audit), mismo patrón que authentication/photo-feed.

export class MessagingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MessagingError'
  }
}

/**
 * Falta el ActorContext. A diferencia de photo-feed (legacy con modo
 * abierto), messaging nace fail-closed (ADR-0015): el actor es obligatorio
 * en TODA la API, haya o no authorizer en el contexto.
 */
export class PermissionRequiredError extends MessagingError {
  readonly permission: string

  constructor(permission: string) {
    super(
      `Permission check required for '${permission}': pass an ActorContext (messaging requires an actor in every operation)`
    )
    this.name = 'PermissionRequiredError'
    this.permission = permission
  }
}

/**
 * La decisión de autorización no fue ALLOW. CONDITIONAL se trata como
 * denegación (enforcement loop: deuda ADR-0011 §6, igual que photo-feed).
 */
export class PermissionDeniedError extends MessagingError {
  readonly permission: string
  readonly decision: 'DENY' | 'CONDITIONAL'
  readonly reason: string
  readonly conditions?: readonly string[]

  constructor(
    permission: string,
    decision: 'DENY' | 'CONDITIONAL',
    reason: string,
    conditions?: readonly string[]
  ) {
    super(
      `Permission denied for '${permission}' (${decision}: ${reason}` +
        (conditions?.length ? `, conditions: ${conditions.join(', ')}` : '') +
        ')'
    )
    this.name = 'PermissionDeniedError'
    this.permission = permission
    this.decision = decision
    this.reason = reason
    this.conditions = conditions
  }
}

/**
 * Conversación inexistente O el actor no es participante: el MISMO error en
 * ambos casos (anti-sondeo: no revela qué ids existen). La participación es
 * invariante de dominio siempre activa, independiente del Authorizer
 * (privacidad de las conversaciones, ADR-0015).
 */
export class ConversationNotAccessibleError extends MessagingError {
  constructor() {
    super('Conversation not found or not accessible')
    this.name = 'ConversationNotAccessibleError'
  }
}

/** Mensaje inexistente (o de una conversación inconsistente). */
export class MessageNotFoundError extends MessagingError {
  readonly messageId: string

  constructor(messageId: string) {
    super(`Message '${messageId}' not found`)
    this.name = 'MessageNotFoundError'
    this.messageId = messageId
  }
}

/** Operación sobre un mensaje ya eliminado (tombstone). */
export class MessageAlreadyDeletedError extends MessagingError {
  readonly messageId: string

  constructor(messageId: string) {
    super(`Message '${messageId}' is already deleted`)
    this.name = 'MessageAlreadyDeletedError'
    this.messageId = messageId
  }
}

/** El actor no es el autor del mensaje (edición/borrado sin permiso de moderación). */
export class NotMessageAuthorError extends MessagingError {
  readonly messageId: string

  constructor(messageId: string) {
    super(`Only the author can perform this operation on message '${messageId}'`)
    this.name = 'NotMessageAuthorError'
    this.messageId = messageId
  }
}

/** Participantes inválidos (cantidad, duplicados, creador ausente, ids vacíos). */
export class InvalidParticipantsError extends MessagingError {
  constructor(reason: string) {
    super(`Invalid participants: ${reason}`)
    this.name = 'InvalidParticipantsError'
  }
}

/** Cuerpo de mensaje inválido (vacío, no string, excede la política). */
export class InvalidMessageBodyError extends MessagingError {
  constructor(reason: string) {
    super(`Invalid message body: ${reason}`)
    this.name = 'InvalidMessageBodyError'
  }
}

/** Título de conversación grupal inválido. */
export class InvalidConversationTitleError extends MessagingError {
  constructor(reason: string) {
    super(`Invalid conversation title: ${reason}`)
    this.name = 'InvalidConversationTitleError'
  }
}

/** Cursor de paginación (`before`) que no corresponde a la conversación. */
export class InvalidCursorError extends MessagingError {
  constructor(cursor: string) {
    super(`Unknown pagination cursor '${cursor}'`)
    this.name = 'InvalidCursorError'
  }
}
