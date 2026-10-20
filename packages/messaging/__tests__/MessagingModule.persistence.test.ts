// Persistencia del módulo messaging (ADR-0003): records planos, identidad
// estable, rehidratación completa (índices, seq, dedup de DMs, tombstones).
import { describe, it, expect, beforeEach } from 'vitest'
import { MessagingModule } from '../MessagingModule.js'
import { InMemoryEventBus, InMemoryPersistenceAdapter } from '@morningstar/core'
import type { ActorContext, CoreContext, CoreEventMap, Storage } from '@morningstar/core'

const nullStorage: Storage = {
  get: async () => null,
  set: async () => {},
  remove: async () => {},
  exists: async () => false,
}

const A: ActorContext = { sessionToken: 'token-a', userId: 'user-a' }
const B: ActorContext = { sessionToken: 'token-b', userId: 'user-b' }

describe('MessagingModule — persistencia y rehidratación', () => {
  let persistence: InMemoryPersistenceAdapter
  let bus: InMemoryEventBus<CoreEventMap>

  const init = async () => {
    const module = new MessagingModule()
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

  beforeEach(() => {
    persistence = new InMemoryPersistenceAdapter()
    bus = new InMemoryEventBus<CoreEventMap>()
  })

  it('una segunda instancia sobre la misma persistencia rehidrata todo el estado', async () => {
    const first = await init()

    const dm = await first.getOrCreateDirectConversation('user-b', A)
    const group = await first.createGroupConversation(
      { title: 'Grupo', participantIds: ['user-b'] },
      A
    )
    const m1 = await first.sendMessage(dm.conversationId, 'uno', A)
    await first.sendMessage(dm.conversationId, 'dos', B)
    const m3 = await first.sendMessage(dm.conversationId, 'tres', A)
    await first.editMessage(m3.messageId, 'tres (editado)', A)
    await first.deleteMessage(m1.messageId, A)
    await first.sendMessage(group.conversationId, 'hola grupo', A)
    await first.dispose()

    // ── Nueva instancia (simula recarga de página / reinicio de backend) ──
    const second = await init()

    // Conversaciones + índices de participantes
    const conversations = await second.listConversations(A)
    expect(conversations).toHaveLength(2)
    const dmRestored = conversations.find((c) => c.kind === 'direct')!
    expect(dmRestored.conversationId).toBe(dm.conversationId)
    expect(dmRestored.title).toBeUndefined()
    expect(conversations.find((c) => c.kind === 'group')!.title).toBe('Grupo')

    // Dedup de DM reconstruido: getOrCreate NO duplica (en ambas direcciones)
    const again = await second.getOrCreateDirectConversation('user-b', A)
    expect(again.conversationId).toBe(dm.conversationId)
    const againFromB = await second.getOrCreateDirectConversation('user-a', B)
    expect(againFromB.conversationId).toBe(dm.conversationId)

    // Mensajes: orden por seq, tombstone y edición sobreviven
    const page = await second.listMessages(dm.conversationId, {}, A)
    expect(page.messages.map((m) => m.seq)).toEqual([1, 2, 3])
    expect(page.messages[0]).toMatchObject({ messageId: m1.messageId, body: '', authorId: 'user-a' })
    expect(page.messages[0]!.deletedAt).toBeTypeOf('number')
    expect(page.messages[2]).toMatchObject({ body: 'tres (editado)' })
    expect(page.messages[2]!.editedAt).toBeTypeOf('number')

    // seq continúa tras rehidratar (no colisiona con los existentes)
    const m4 = await second.sendMessage(dm.conversationId, 'cuatro', B)
    expect(m4.seq).toBe(4)

    // La paginación con cursor funciona sobre datos rehidratados
    const last2 = await second.listMessages(dm.conversationId, { limit: 2 }, A)
    expect(last2.messages.map((m) => m.body)).toEqual(['tres (editado)', 'cuatro'])
    const prev = await second.listMessages(
      dm.conversationId,
      { limit: 2, before: last2.nextCursor },
      A
    )
    expect(prev.messages.map((m) => m.seq)).toEqual([1, 2])
  })

  it('los records son planos y viven en los namespaces del módulo', async () => {
    const module = await init()
    const dm = await module.getOrCreateDirectConversation('user-b', A)
    await module.sendMessage(dm.conversationId, 'persistido', A)

    const conversations = await persistence.repository<{ id: string }>('messaging:conversations').list()
    const messages = await persistence.repository<{ id: string; body: string }>('messaging:messages').list()

    expect(conversations).toHaveLength(1)
    expect(conversations[0]!.id).toBe(dm.conversationId)
    expect(messages).toHaveLength(1)
    expect(messages[0]!.body).toBe('persistido')
    // Sin agregados de dominio filtrados: solo datos serializables
    expect(JSON.parse(JSON.stringify(messages[0]))).toEqual(messages[0])
  })
})
