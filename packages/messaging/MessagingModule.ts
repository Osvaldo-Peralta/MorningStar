// messaging/MessagingModule.ts
// Módulo de mensajería (Fase 6, Iteración 9a): conversaciones 1:1 y grupales
// con mensajes de texto. Nace con enforcement desde el día uno (patrón 7b,
// ADR-0012/0015): ActorContext obligatorio en TODA la API pública +
// Authorizer opcional en el contexto (si está, fail-closed) + invariante de
// dominio siempre activa: solo los participantes acceden a una conversación.
import { ModuleState } from '@morningstar/core'
import type {
  ActorContext,
  AppModule,
  Authorizer,
  CoreContext,
  DomainEvent,
  Repository,
} from '@morningstar/core'
import { nanoid } from 'nanoid'
import { Conversation, type ConversationInfo } from './domain/Conversation.js'
import { Message, type MessageInfo } from './domain/Message.js'
import type { ConversationRecord } from './domain/ConversationRecord.js'
import type { MessageRecord } from './domain/MessageRecord.js'
import {
  directPairKey,
  resolveMessagingPolicy,
  type MessagingPolicy,
  type MessagingPolicyOverrides,
} from './domain/messagingPolicy.js'
import { MSG_EVENTS } from './events.js'
import type {
  ConversationCreatedPayload,
  MessageSentPayload,
  MessageEditedPayload,
  MessageDeletedPayload,
} from './events.js'
import {
  ConversationNotAccessibleError,
  InvalidCursorError,
  InvalidParticipantsError,
  MessageNotFoundError,
  NotMessageAuthorError,
  PermissionDeniedError,
  PermissionRequiredError,
} from './errors.js'

/** Namespaces de repositorios (ADR-0002/0003: `<modulo>:<recurso>`). */
const CONVERSATIONS_NAMESPACE = 'messaging:conversations'
const MESSAGES_NAMESPACE = 'messaging:messages'

export interface MessagingModuleOptions {
  /** Ajustes de política por instancia (defaults en MESSAGING_POLICY). */
  policy?: MessagingPolicyOverrides
}

/** Página de mensajes: orden cronológico ascendente + cursor hacia atrás. */
export interface MessagePage {
  readonly messages: readonly MessageInfo[]
  /** Id del mensaje más viejo de la página cuando hay anteriores; si no, ausente. */
  readonly nextCursor?: string
}

export interface ListMessagesPage {
  /** Tamaño de página (1..maxPageSize; default `defaultPageSize`). */
  readonly limit?: number
  /** Cursor exclusivo: devuelve mensajes anteriores a este messageId. */
  readonly before?: string
}

/**
 * Módulo de mensajería (Fase 6 — comunidades y comunicación, corte 9a).
 *
 * Alcance v1 (ADR-0015): conversaciones `direct` (idempotentes por par de
 * usuarios) y `group`; mensajes de texto con edición (`editedAt`) y borrado
 * **soft** (tombstone con cuerpo vaciado); listados paginados por cursor
 * determinista (`seq` monotónico por conversación).
 *
 * Seguridad por diseño:
 * - ActorContext obligatorio en toda la API (a diferencia de photo-feed, no
 *   hay modo anónimo legacy: el módulo nace fail-closed).
 * - Con `authorizer` en el contexto, cada comando pasa por evaluación de
 *   permisos (`msg:send/read/edit/delete`, variantes `-own` por autoría).
 * - Invariante de dominio SIEMPRE activa: solo participantes leen/escriben
 *   en una conversación; `ConversationNotAccessibleError` idéntico para id
 *   inexistente y no-participante (anti-sondeo).
 * - Excepción de moderación: con authorizer, un rol con `msg:delete` pleno
 *   puede borrar mensajes ajenos (aun sin participar de la conversación).
 *   La edición es SIEMPRE solo del autor (integridad de `editedAt`).
 */
export class MessagingModule implements AppModule {
  readonly id = 'messaging'
  readonly version = '0.1.0'

  state = ModuleState.Registered

  private readonly policy: MessagingPolicy
  private conversationRepo?: Repository<ConversationRecord>
  private messageRepo?: Repository<MessageRecord>
  private authorizer?: Authorizer
  private events?: CoreContext['events']

  private conversations = new Map<string, Conversation>()
  private messages = new Map<string, Message>()
  /** conversationId → mensajes en orden `seq` ascendente. */
  private byConversation = new Map<string, Message[]>()
  /** pairKey (direct) → conversationId: dedup de DMs. */
  private directIndex = new Map<string, string>()
  /** conversationId → próximo seq (monotónico, persiste vía records). */
  private nextSeq = new Map<string, number>()

  constructor(options: MessagingModuleOptions = {}) {
    this.policy = resolveMessagingPolicy(options.policy)
  }

  async init(context: CoreContext): Promise<void> {
    // La persistencia con identidad estable es obligatoria (Fase 1):
    // sin backend los mensajes vivirían solo en memoria.
    if (!context.persistence) {
      throw new Error(
        "MessagingModule requiere 'context.persistence' (PersistenceProvider). Ver docs/contracts/messaging.md"
      )
    }

    this.conversationRepo = context.persistence.repository<ConversationRecord>(CONVERSATIONS_NAMESPACE)
    this.messageRepo = context.persistence.repository<MessageRecord>(MESSAGES_NAMESPACE)
    this.authorizer = context.authorizer // opcional: activa el enforcement por roles (ADR-0012)
    this.events = context.events

    // Hidratación: records → agregados + índices (identidad estable).
    for (const record of await this.conversationRepo.list()) {
      const conversation = Conversation.fromRecord(record)
      this.conversations.set(conversation.id, conversation)
      if (conversation.kind === 'direct') {
        const [a, b] = conversation.participantIds
        this.directIndex.set(directPairKey(a!, b!), conversation.id)
      }
    }

    const messageRecords = await this.messageRepo.list()
    // Orden determinista por (conversationId, seq): el orden de list() no
    // está garantizado y `seq` es la fuente de verdad del ordenamiento.
    messageRecords.sort((x, y) =>
      x.conversationId === y.conversationId ? x.seq - y.seq : x.conversationId < y.conversationId ? -1 : 1
    )
    for (const record of messageRecords) {
      const message = Message.fromRecord(record)
      this.messages.set(message.id, message)
      const list = this.byConversation.get(message.conversationId)
      if (list) list.push(message)
      else this.byConversation.set(message.conversationId, [message])
      this.nextSeq.set(message.conversationId, Math.max(this.nextSeq.get(message.conversationId) ?? 0, message.seq) + 1)
    }
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
  async dispose(): Promise<void> {
    this.conversations.clear()
    this.messages.clear()
    this.byConversation.clear()
    this.directIndex.clear()
    this.nextSeq.clear()
    this.conversationRepo = undefined
    this.messageRepo = undefined
    this.authorizer = undefined
    this.events = undefined
  }

  // ── Enforcement (ADR-0012, patrón 7b) ─────────────────────────────────

  private async checkPermission(
    permission: string,
    resource: { type: string; id?: string; ownerId?: string } | undefined,
    actor: ActorContext
  ): Promise<void> {
    if (!this.authorizer) return
    // Fail-closed estricto: con authorizer, el actor SIEMPRE existe en esta
    // API (parámetro requerido); el chequeo defensivo cubre composiciones
    // que fuercen tipos (tests, JS sin tipos).
    if (!actor) throw new PermissionRequiredError(permission)

    const decision = await this.authorizer.authorize(
      resource ? { permission, resource } : { permission },
      actor.sessionToken
    )

    if (decision.decision === 'ALLOW') return

    throw new PermissionDeniedError(
      permission,
      decision.decision as 'DENY' | 'CONDITIONAL',
      decision.reason,
      decision.conditions
    )
  }

  /** Conversación existente Y participante; mismo error para ambos fallos (anti-sondeo). */
  private requireAccessibleConversation(conversationId: string, actor: ActorContext): Conversation {
    const conversation = this.conversations.get(conversationId)
    if (!conversation || !conversation.isParticipant(actor.userId)) {
      throw new ConversationNotAccessibleError()
    }
    return conversation
  }

  /**
   * ActorContext obligatorio en TODA la API (ADR-0015: el módulo nace
   * fail-closed, sin modo anónimo legacy). Guarda defensiva de runtime para
   * composiciones que fuercen los tipos (JS sin tipos, tests).
   */
  private requireActor(actor: ActorContext, permission: string): void {
    if (!actor || typeof actor.userId !== 'string' || actor.userId === '') {
      throw new PermissionRequiredError(permission)
    }
  }

  private requireInitialized(): void {
    if (!this.conversationRepo || !this.messageRepo || !this.events) {
      throw new Error('Not Initialized')
    }
  }

  // ── API pública ────────────────────────────────────────────────────────

  /**
   * Conversación directa con `otherUserId`, idempotente por par: si ya
   * existe, la devuelve (no hay DMs duplicados). El actor es participante.
   */
  async getOrCreateDirectConversation(
    otherUserId: string,
    actor: ActorContext
  ): Promise<ConversationInfo> {
    this.requireInitialized()
    this.requireActor(actor, 'msg:send')

    if (typeof otherUserId !== 'string' || otherUserId.trim() === '') {
      throw new InvalidParticipantsError('otherUserId is required')
    }
    if (otherUserId === actor.userId) {
      throw new InvalidParticipantsError('a direct conversation requires two distinct users')
    }

    await this.checkPermission('msg:send', { type: 'conversation' }, actor)

    const key = directPairKey(actor.userId, otherUserId)
    const existingId = this.directIndex.get(key)
    if (existingId) {
      const existing = this.conversations.get(existingId)
      if (existing) return existing.toInfo()
    }

    const conversation = Conversation.create(
      {
        id: nanoid(),
        kind: 'direct',
        participantIds: [actor.userId, otherUserId],
        createdBy: actor.userId,
      },
      this.policy
    )

    await this.persistNewConversation(conversation, key)
    return conversation.toInfo()
  }

  /**
   * Conversación grupal: el creador se agrega automáticamente a los
   * participantes. A diferencia de las directas, siempre crea una nueva.
   */
  async createGroupConversation(
    input: { title?: string; participantIds: readonly string[] },
    actor: ActorContext
  ): Promise<ConversationInfo> {
    this.requireInitialized()
    this.requireActor(actor, 'msg:send')

    await this.checkPermission('msg:send', { type: 'conversation' }, actor)

    const participantIds = [...new Set([actor.userId, ...input.participantIds])]
    const conversation = Conversation.create(
      {
        id: nanoid(),
        kind: 'group',
        participantIds,
        title: input.title,
        createdBy: actor.userId,
      },
      this.policy
    )

    await this.persistNewConversation(conversation)
    return conversation.toInfo()
  }

  /** Envía un mensaje de texto a una conversación (solo participantes). */
  async sendMessage(conversationId: string, body: string, actor: ActorContext): Promise<MessageInfo> {
    this.requireInitialized()
    this.requireActor(actor, 'msg:send')

    await this.checkPermission('msg:send', { type: 'conversation', id: conversationId }, actor)

    const conversation = this.requireAccessibleConversation(conversationId, actor)
    const message = Message.create(
      {
        id: nanoid(),
        conversationId,
        authorId: actor.userId,
        seq: this.nextSeq.get(conversationId) ?? 1,
        body,
      },
      this.policy
    )
    this.nextSeq.set(conversationId, message.seq + 1)
    conversation.touch(message.createdAt)

    await this.messageRepo!.save(message.toRecord())
    await this.conversationRepo!.save(conversation.toRecord())
    const list = this.byConversation.get(conversationId)
    if (list) list.push(message)
    else this.byConversation.set(conversationId, [message])
    this.messages.set(message.id, message)

    const event: DomainEvent<MessageSentPayload> = {
      name: MSG_EVENTS.MESSAGE_SENT,
      category: 'domain',
      source: { moduleId: this.id, entity: 'message', entityId: message.id },
      payload: {
        messageId: message.id,
        conversationId,
        authorId: message.authorId,
        seq: message.seq,
        body: message.body,
        createdAt: message.createdAt,
      },
      timestamp: Date.now(),
    }
    this.events!.emit(event)

    return message.toInfo()
  }

  /**
   * Edita un mensaje. SIEMPRE solo el autor (invariante de dominio): ni
   * admin edita mensajes ajenos (integridad de `editedAt`). Cuerpo idéntico
   * ⇒ no-op sin evento.
   */
  async editMessage(messageId: string, body: string, actor: ActorContext): Promise<MessageInfo> {
    this.requireInitialized()
    this.requireActor(actor, 'msg:edit')

    const message = this.messages.get(messageId)
    if (!message) throw new MessageNotFoundError(messageId)

    await this.checkPermission(
      'msg:edit',
      { type: 'message', id: messageId, ownerId: message.authorId },
      actor
    )

    if (message.authorId !== actor.userId) {
      throw new NotMessageAuthorError(messageId)
    }

    const changed = message.edit(body, this.policy)
    if (!changed) return message.toInfo()

    await this.messageRepo!.save(message.toRecord())

    const event: DomainEvent<MessageEditedPayload> = {
      name: MSG_EVENTS.MESSAGE_EDITED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'message', entityId: message.id },
      payload: {
        messageId: message.id,
        conversationId: message.conversationId,
        authorId: message.authorId,
        body: message.body,
        editedAt: message.editedAt!,
      },
      timestamp: Date.now(),
    }
    this.events!.emit(event)

    return message.toInfo()
  }

  /**
   * Borra un mensaje (soft delete: tombstone con cuerpo vaciado).
   * Autor siempre puede; con authorizer, un rol con `msg:delete` pleno
   * (moderación) puede borrar ajenos aun sin participar de la conversación.
   */
  async deleteMessage(messageId: string, actor: ActorContext): Promise<void> {
    this.requireInitialized()
    this.requireActor(actor, 'msg:delete')

    const message = this.messages.get(messageId)
    if (!message) throw new MessageNotFoundError(messageId)

    const conversation = this.conversations.get(message.conversationId)
    if (!conversation) throw new ConversationNotAccessibleError()

    await this.checkPermission(
      'msg:delete',
      { type: 'message', id: messageId, ownerId: message.authorId },
      actor
    )

    const isAuthor = message.authorId === actor.userId
    if (!isAuthor) {
      // Sin authorizer (modo abierto de tests/composición mínima) solo el
      // autor borra. Con authorizer, llegar acá implica ALLOW de un permiso
      // pleno `msg:delete` (la variante -own ya habría DENYado): moderación.
      if (!this.authorizer) throw new NotMessageAuthorError(messageId)
    }

    message.delete()
    await this.messageRepo!.save(message.toRecord())

    const event: DomainEvent<MessageDeletedPayload> = {
      name: MSG_EVENTS.MESSAGE_DELETED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'message', entityId: message.id },
      payload: {
        messageId: message.id,
        conversationId: message.conversationId,
        deletedBy: actor.userId,
        deletedAt: message.deletedAt!,
      },
      timestamp: Date.now(),
    }
    this.events!.emit(event)
  }

  /** Conversaciones del actor, más recientes primero. */
  async listConversations(actor: ActorContext): Promise<ConversationInfo[]> {
    this.requireInitialized()
    this.requireActor(actor, 'msg:read')

    await this.checkPermission('msg:read', undefined, actor)

    return [...this.conversations.values()]
      .filter((c) => c.isParticipant(actor.userId))
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt) - (a.lastMessageAt ?? a.createdAt))
      .map((c) => c.toInfo())
  }

  /** Detalle de una conversación (solo participantes). */
  async getConversation(conversationId: string, actor: ActorContext): Promise<ConversationInfo> {
    this.requireInitialized()
    this.requireActor(actor, 'msg:read')

    await this.checkPermission('msg:read', { type: 'conversation', id: conversationId }, actor)

    return this.requireAccessibleConversation(conversationId, actor).toInfo()
  }

  /**
   * Mensajes de una conversación (solo participantes), orden cronológico
   * ascendente con paginación por cursor hacia atrás: `before` es exclusivo
   * y `nextCursor` aparece cuando quedan mensajes anteriores.
   * Los tombstones (deletedAt) SE incluyen con `body: ''` (la UI decide
   * cómo mostrarlos; el orden de la conversación no se rompe).
   */
  async listMessages(
    conversationId: string,
    page: ListMessagesPage = {},
    actor: ActorContext
  ): Promise<MessagePage> {
    this.requireInitialized()
    this.requireActor(actor, 'msg:read')

    await this.checkPermission('msg:read', { type: 'conversation', id: conversationId }, actor)

    this.requireAccessibleConversation(conversationId, actor)

    const all = this.byConversation.get(conversationId) ?? []
    const limit = Math.min(
      Math.max(page.limit ?? this.policy.defaultPageSize, 1),
      this.policy.maxPageSize
    )

    let candidates = all
    if (page.before !== undefined) {
      const cursorIndex = all.findIndex((m) => m.id === page.before)
      if (cursorIndex === -1) throw new InvalidCursorError(page.before)
      candidates = all.slice(0, cursorIndex)
    }

    const start = Math.max(0, candidates.length - limit)
    const window = candidates.slice(start)
    const hasMore = start > 0

    return {
      messages: window.map((m) => m.toInfo()),
      ...(hasMore ? { nextCursor: window[0]!.id } : {}),
    }
  }

  // ── Internos ───────────────────────────────────────────────────────────

  private async persistNewConversation(conversation: Conversation, directKey?: string): Promise<void> {
    await this.conversationRepo!.save(conversation.toRecord())
    this.conversations.set(conversation.id, conversation)
    if (conversation.kind === 'direct' && directKey) {
      this.directIndex.set(directKey, conversation.id)
    }

    const payload: ConversationCreatedPayload = {
      conversationId: conversation.id,
      kind: conversation.kind,
      participantIds: conversation.participantIds,
      ...(conversation.title !== undefined ? { title: conversation.title } : {}),
      createdBy: conversation.createdBy,
      createdAt: conversation.createdAt,
    }
    const event: DomainEvent<ConversationCreatedPayload> = {
      name: MSG_EVENTS.CONVERSATION_CREATED,
      category: 'domain',
      source: { moduleId: this.id, entity: 'conversation', entityId: conversation.id },
      payload,
      timestamp: Date.now(),
    }
    this.events!.emit(event)
  }
}
