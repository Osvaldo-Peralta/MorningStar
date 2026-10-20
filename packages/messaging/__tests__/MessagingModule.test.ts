// MessagingModule — flujos en modo abierto (sin authorizer): conversaciones,
// mensajes, paginación, invariante de participantes y eventos (ADR-0015).
import { describe, it, expect, beforeEach } from 'vitest'
import { MessagingModule } from '../MessagingModule.js'
import {
  ConversationNotAccessibleError,
  InvalidCursorError,
  InvalidMessageBodyError,
  InvalidParticipantsError,
  MessageAlreadyDeletedError,
  MessageNotFoundError,
  NotMessageAuthorError,
} from '../errors.js'
import { InMemoryEventBus, InMemoryPersistenceAdapter } from '@morningstar/core'
import type { ActorContext, CoreContext, CoreEventMap, DomainEvent, Storage } from '@morningstar/core'

const nullStorage: Storage = {
  get: async () => null,
  set: async () => {},
  remove: async () => {},
  exists: async () => false,
}

const A: ActorContext = { sessionToken: 'token-a', userId: 'user-a' }
const B: ActorContext = { sessionToken: 'token-b', userId: 'user-b' }
const C: ActorContext = { sessionToken: 'token-c', userId: 'user-c' }

describe('MessagingModule — flujos (modo abierto)', () => {
  let persistence: InMemoryPersistenceAdapter
  let bus: InMemoryEventBus<CoreEventMap>
  let emitted: DomainEvent<unknown>[]
  let messaging: MessagingModule

  const init = async (module = new MessagingModule()) => {
    await module.init({
      events: bus,
      storage: nullStorage,
      persistence,
      permission: { has: () => true, request: async () => true },
      logger: console,
      config: { environment: 'test', version: '0.0.0' },
    } as CoreContext<CoreEventMap>)
    return module
  }

  beforeEach(async () => {
    persistence = new InMemoryPersistenceAdapter()
    bus = new InMemoryEventBus<CoreEventMap>()
    emitted = []
    bus.on('*', (event) => emitted.push(event))
    messaging = await init()
  })

  const eventsOf = (name: string) => emitted.filter((e) => e.name === name)

  describe('conversaciones directas', () => {
    it('crea la DM con ambos participantes y emite msg:conversation-created', async () => {
      const info = await messaging.getOrCreateDirectConversation('user-b', A)

      expect(info).toMatchObject({ kind: 'direct', createdBy: 'user-a' })
      expect(info.participantIds).toEqual(['user-a', 'user-b'])
      expect(info.lastMessageAt).toBeUndefined()

      const created = eventsOf('msg:conversation-created')
      expect(created).toHaveLength(1)
      expect(created[0]!.payload).toMatchObject({
        conversationId: info.conversationId,
        kind: 'direct',
        participantIds: ['user-a', 'user-b'],
      })
    })

    it('idempotente por par: A→B y B→A devuelven la MISMA conversación', async () => {
      const fromA = await messaging.getOrCreateDirectConversation('user-b', A)
      const fromA2 = await messaging.getOrCreateDirectConversation('user-b', A)
      const fromB = await messaging.getOrCreateDirectConversation('user-a', B)

      expect(fromA.conversationId).toBe(fromA2.conversationId)
      expect(fromA.conversationId).toBe(fromB.conversationId)
      expect(eventsOf('msg:conversation-created')).toHaveLength(1)
    })

    it('self-DM y otherUserId inválido ⇒ InvalidParticipantsError', async () => {
      await expect(messaging.getOrCreateDirectConversation('user-a', A)).rejects.toThrow(
        InvalidParticipantsError
      )
      await expect(messaging.getOrCreateDirectConversation('  ', A)).rejects.toThrow(
        InvalidParticipantsError
      )
    })
  })

  describe('conversaciones grupales', () => {
    it('creador entra automáticamente; título con trim; participantes dedup', async () => {
      const info = await messaging.createGroupConversation(
        { title: '  Equipo  ', participantIds: ['user-b', 'user-c', 'user-b'] },
        A
      )

      expect(info.kind).toBe('group')
      expect(info.title).toBe('Equipo')
      expect(info.participantIds).toEqual(['user-a', 'user-b', 'user-c'])
      expect(info.createdBy).toBe('user-a')
    })

    it('grupo sin otros participantes ⇒ InvalidParticipantsError (mín. 2)', async () => {
      await expect(
        messaging.createGroupConversation({ participantIds: [] }, A)
      ).rejects.toThrow(InvalidParticipantsError)
      await expect(
        messaging.createGroupConversation({ participantIds: ['user-a'] }, A)
      ).rejects.toThrow(InvalidParticipantsError)
    })
  })

  describe('sendMessage', () => {
    it('envía, asigna seq monotónico, toca lastMessageAt y emite msg:sent', async () => {
      const dm = await messaging.getOrCreateDirectConversation('user-b', A)

      const m1 = await messaging.sendMessage(dm.conversationId, '  primero  ', A)
      const m2 = await messaging.sendMessage(dm.conversationId, 'segundo', B)

      expect(m1).toMatchObject({ authorId: 'user-a', seq: 1, body: 'primero' })
      expect(m2).toMatchObject({ authorId: 'user-b', seq: 2, body: 'segundo' })

      const conv = await messaging.getConversation(dm.conversationId, A)
      expect(conv.lastMessageAt).toBe(m2.createdAt)

      const sent = eventsOf('msg:sent')
      expect(sent).toHaveLength(2)
      expect(sent[1]!.payload).toMatchObject({
        messageId: m2.messageId,
        conversationId: dm.conversationId,
        authorId: 'user-b',
        body: 'segundo',
        seq: 2,
      })
    })

    it('conversación inexistente y no-participante ⇒ MISMO error (anti-sondeo), cero efectos', async () => {
      const dm = await messaging.getOrCreateDirectConversation('user-b', A)

      await expect(messaging.sendMessage('conv-fantasma', 'hola', A)).rejects.toThrow(
        ConversationNotAccessibleError
      )
      await expect(messaging.sendMessage(dm.conversationId, 'hola', C)).rejects.toThrow(
        ConversationNotAccessibleError
      )
      const page = await messaging.listMessages(dm.conversationId, {}, A)
      expect(page.messages).toHaveLength(0)
    })

    it('cuerpo inválido ⇒ InvalidMessageBodyError sin mensaje ni evento', async () => {
      const dm = await messaging.getOrCreateDirectConversation('user-b', A)
      const before = eventsOf('msg:sent').length

      await expect(messaging.sendMessage(dm.conversationId, '   ', A)).rejects.toThrow(
        InvalidMessageBodyError
      )
      expect(eventsOf('msg:sent')).toHaveLength(before)
      expect((await messaging.listMessages(dm.conversationId, {}, A)).messages).toHaveLength(0)
    })
  })

  describe('editMessage', () => {
    it('autor edita: editedAt + msg:edited; cuerpo idéntico ⇒ no-op sin evento', async () => {
      const dm = await messaging.getOrCreateDirectConversation('user-b', A)
      const m = await messaging.sendMessage(dm.conversationId, 'original', A)

      const noop = await messaging.editMessage(m.messageId, 'original', A)
      expect(noop.editedAt).toBeUndefined()
      expect(eventsOf('msg:edited')).toHaveLength(0)

      const edited = await messaging.editMessage(m.messageId, 'corregido', A)
      expect(edited).toMatchObject({ body: 'corregido', authorId: 'user-a' })
      expect(edited.editedAt).toBeTypeOf('number')

      expect(eventsOf('msg:edited')).toHaveLength(1)
      expect(eventsOf('msg:edited')[0]!.payload).toMatchObject({
        messageId: m.messageId,
        body: 'corregido',
      })
    })

    it('no-autor ⇒ NotMessageAuthorError (modo abierto); id desconocido ⇒ MessageNotFoundError', async () => {
      const dm = await messaging.getOrCreateDirectConversation('user-b', A)
      const m = await messaging.sendMessage(dm.conversationId, 'mío', A)

      await expect(messaging.editMessage(m.messageId, 'ajeno', B)).rejects.toThrow(
        NotMessageAuthorError
      )
      await expect(messaging.editMessage('msg-fantasma', 'x', A)).rejects.toThrow(
        MessageNotFoundError
      )
    })

    it('sobre un tombstone ⇒ MessageAlreadyDeletedError', async () => {
      const dm = await messaging.getOrCreateDirectConversation('user-b', A)
      const m = await messaging.sendMessage(dm.conversationId, 'borrable', A)
      await messaging.deleteMessage(m.messageId, A)

      await expect(messaging.editMessage(m.messageId, 'revivir', A)).rejects.toThrow(
        MessageAlreadyDeletedError
      )
    })
  })

  describe('deleteMessage (soft delete)', () => {
    it('autor borra: tombstone con cuerpo vaciado + msg:deleted', async () => {
      const dm = await messaging.getOrCreateDirectConversation('user-b', A)
      const m = await messaging.sendMessage(dm.conversationId, 'secreto', A)

      await messaging.deleteMessage(m.messageId, A)

      const page = await messaging.listMessages(dm.conversationId, {}, B)
      expect(page.messages).toHaveLength(1)
      expect(page.messages[0]).toMatchObject({ body: '', authorId: 'user-a' })
      expect(page.messages[0]!.deletedAt).toBeTypeOf('number')

      expect(eventsOf('msg:deleted')[0]!.payload).toMatchObject({
        messageId: m.messageId,
        conversationId: dm.conversationId,
        deletedBy: 'user-a',
      })
    })

    it('doble borrado ⇒ MessageAlreadyDeletedError; no-autor ⇒ NotMessageAuthorError', async () => {
      const dm = await messaging.getOrCreateDirectConversation('user-b', A)
      const m = await messaging.sendMessage(dm.conversationId, 'x', A)

      await messaging.deleteMessage(m.messageId, A)
      await expect(messaging.deleteMessage(m.messageId, A)).rejects.toThrow(
        MessageAlreadyDeletedError
      )

      const m2 = await messaging.sendMessage(dm.conversationId, 'y', A)
      await expect(messaging.deleteMessage(m2.messageId, B)).rejects.toThrow(NotMessageAuthorError)
    })
  })

  describe('listConversations / getConversation', () => {
    it('filtra por participante y ordena por actividad reciente', async () => {
      const dm = await messaging.getOrCreateDirectConversation('user-b', A)
      const group = await messaging.createGroupConversation(
        { title: 'Grupo', participantIds: ['user-b', 'user-c'] },
        A
      )

      // Actividad solo en la DM ⇒ queda primera
      await messaging.sendMessage(dm.conversationId, 'hola', A)

      const forA = await messaging.listConversations(A)
      expect(forA.map((c) => c.conversationId)).toEqual([dm.conversationId, group.conversationId])

      const forC = await messaging.listConversations(C)
      expect(forC.map((c) => c.conversationId)).toEqual([group.conversationId])

      // Anti-sondeo también en lecturas
      await expect(messaging.getConversation(dm.conversationId, C)).rejects.toThrow(
        ConversationNotAccessibleError
      )
      await expect(messaging.getConversation('conv-fantasma', A)).rejects.toThrow(
        ConversationNotAccessibleError
      )
    })
  })

  describe('listMessages — paginación por cursor', () => {
    it('orden ascendente, páginas hacia atrás con nextCursor, cursor inválido ⇒ error', async () => {
      const dm = await messaging.getOrCreateDirectConversation('user-b', A)
      const ids: string[] = []
      for (let i = 1; i <= 5; i++) {
        ids.push((await messaging.sendMessage(dm.conversationId, `m${i}`, A)).messageId)
      }

      // Página por defecto: todo, ascendente
      const full = await messaging.listMessages(dm.conversationId, {}, A)
      expect(full.messages.map((m) => m.body)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5'])
      expect(full.nextCursor).toBeUndefined()

      // Última página de 2
      const last = await messaging.listMessages(dm.conversationId, { limit: 2 }, A)
      expect(last.messages.map((m) => m.body)).toEqual(['m4', 'm5'])
      expect(last.nextCursor).toBe(ids[3]) // m4: hay anteriores

      // Página anterior con el cursor
      const prev = await messaging.listMessages(dm.conversationId, { limit: 2, before: last.nextCursor }, A)
      expect(prev.messages.map((m) => m.body)).toEqual(['m2', 'm3'])
      expect(prev.nextCursor).toBe(ids[1]) // m2

      // Principio: sin nextCursor
      const first = await messaging.listMessages(dm.conversationId, { limit: 10, before: prev.nextCursor }, A)
      expect(first.messages.map((m) => m.body)).toEqual(['m1'])
      expect(first.nextCursor).toBeUndefined()

      await expect(
        messaging.listMessages(dm.conversationId, { before: 'msg-fantasma' }, A)
      ).rejects.toThrow(InvalidCursorError)
    })

    it('limit se acota a 1..maxPageSize', async () => {
      const dm = await messaging.getOrCreateDirectConversation('user-b', A)
      await messaging.sendMessage(dm.conversationId, 'uno', A)

      const zero = await messaging.listMessages(dm.conversationId, { limit: 0 }, A)
      expect(zero.messages).toHaveLength(1)
      const huge = await messaging.listMessages(dm.conversationId, { limit: 99_999 }, A)
      expect(huge.messages).toHaveLength(1)
    })

    it('solo participantes (mismo error anti-sondeo)', async () => {
      const dm = await messaging.getOrCreateDirectConversation('user-b', A)
      await expect(messaging.listMessages(dm.conversationId, {}, C)).rejects.toThrow(
        ConversationNotAccessibleError
      )
    })
  })

  it('init sin persistence ⇒ error explícito', async () => {
    const module = new MessagingModule()
    await expect(
      module.init({
        events: bus,
        storage: nullStorage,
        permission: { has: () => true, request: async () => true },
        logger: console,
        config: { environment: 'test', version: '0.0.0' },
      } as unknown as CoreContext<CoreEventMap>)
    ).rejects.toThrow(/persistence/)
  })
})
