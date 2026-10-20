// Enforcement de autorización en messaging (ADR-0012/0015): actor obligatorio,
// fail-closed, cero efectos colaterales en DENY, moderación y la invariante
// de participantes (independiente de roles).
import { describe, it, expect, beforeEach } from 'vitest'
import { MessagingModule } from '../MessagingModule.js'
import {
  ConversationNotAccessibleError,
  NotMessageAuthorError,
  PermissionDeniedError,
  PermissionRequiredError,
} from '../errors.js'
import { InMemoryEventBus, InMemoryPersistenceAdapter } from '@morningstar/core'
import type {
  ActorContext,
  AuthorizationDecisionSpec,
  AuthorizationRequestSpec,
  Authorizer,
  CoreContext,
  CoreEventMap,
  DomainEvent,
  Storage,
} from '@morningstar/core'

const nullStorage: Storage = {
  get: async () => null,
  set: async () => {},
  remove: async () => {},
  exists: async () => false,
}

const A: ActorContext = { sessionToken: 'token-a', userId: 'user-a' }
const B: ActorContext = { sessionToken: 'token-b', userId: 'user-b' }
const MODERATOR: ActorContext = { sessionToken: 'token-mod', userId: 'user-mod' }

const ALLOW: AuthorizationDecisionSpec = { decision: 'ALLOW', reason: 'role:member' }
const DENY: AuthorizationDecisionSpec = { decision: 'DENY', reason: 'role:guest' }

const fixedAuthorizer = (
  decision: AuthorizationDecisionSpec,
  spy?: (req: AuthorizationRequestSpec, sessionToken: string) => void
): Authorizer => ({
  authorize: async (request, sessionToken) => {
    spy?.(request, sessionToken)
    return decision
  },
})

describe('MessagingModule — enforcement (ADR-0012/0015)', () => {
  let persistence: InMemoryPersistenceAdapter
  let bus: InMemoryEventBus<CoreEventMap>
  let emitted: DomainEvent<unknown>[]
  let requests: AuthorizationRequestSpec[]

  const makeModule = async (authorizer?: Authorizer): Promise<MessagingModule> => {
    const module = new MessagingModule()
    await module.init({
      events: bus,
      storage: nullStorage,
      persistence,
      authorizer,
      permission: { has: () => true, request: async () => true },
      logger: console,
      config: { environment: 'test', version: '0.0.0' },
    } as CoreContext<CoreEventMap>)
    return module
  }

  beforeEach(() => {
    persistence = new InMemoryPersistenceAdapter()
    bus = new InMemoryEventBus<CoreEventMap>()
    emitted = []
    requests = []
    bus.on('*', (event) => emitted.push(event))
  })

  it('con authorizer y sin actor: fail-closed en toda la API (PermissionRequiredError)', async () => {
    const module = await makeModule(fixedAuthorizer(ALLOW))
    const noActor = undefined as unknown as ActorContext

    await expect(module.getOrCreateDirectConversation('user-b', noActor)).rejects.toThrow(
      PermissionRequiredError
    )
    await expect(
      module.createGroupConversation({ participantIds: ['user-b'] }, noActor)
    ).rejects.toThrow(PermissionRequiredError)
    await expect(module.sendMessage('conv-1', 'hola', noActor)).rejects.toThrow(
      PermissionRequiredError
    )
    await expect(module.editMessage('msg-1', 'hola', noActor)).rejects.toThrow(
      PermissionRequiredError
    )
    await expect(module.deleteMessage('msg-1', noActor)).rejects.toThrow(PermissionRequiredError)
    await expect(module.listConversations(noActor)).rejects.toThrow(PermissionRequiredError)
    await expect(module.listMessages('conv-1', {}, noActor)).rejects.toThrow(
      PermissionRequiredError
    )
    expect(emitted).toHaveLength(0)
  })

  it('DENY: cero efectos colaterales (ni conversación, ni mensajes, ni eventos)', async () => {
    const module = await makeModule(fixedAuthorizer(DENY))

    await expect(module.getOrCreateDirectConversation('user-b', A)).rejects.toThrow(
      PermissionDeniedError
    )
    await expect(
      module.createGroupConversation({ participantIds: ['user-b'] }, A)
    ).rejects.toThrow(PermissionDeniedError)

    // Nada persistido: con ALLOW posterior no aparece nada
    const open = await makeModule(fixedAuthorizer(ALLOW))
    expect(await open.listConversations(A)).toHaveLength(0)
    expect(emitted).toHaveLength(0)
  })

  it('DENY en sendMessage/editMessage/deleteMessage sobre datos existentes: sin efectos', async () => {
    const allow = await makeModule(fixedAuthorizer(ALLOW))
    const dm = await allow.getOrCreateDirectConversation('user-b', A)
    const message = await allow.sendMessage(dm.conversationId, 'original', A)
    const before = emitted.length

    const deny = await makeModule(fixedAuthorizer(DENY))
    await expect(deny.sendMessage(dm.conversationId, 'otro', A)).rejects.toThrow(
      PermissionDeniedError
    )
    await expect(deny.editMessage(message.messageId, 'censura', A)).rejects.toThrow(
      PermissionDeniedError
    )
    await expect(deny.deleteMessage(message.messageId, A)).rejects.toThrow(PermissionDeniedError)

    expect(emitted).toHaveLength(before) // ningún evento nuevo
    const page = await allow.listMessages(dm.conversationId, {}, A)
    expect(page.messages).toHaveLength(1)
    expect(page.messages[0]).toMatchObject({ body: 'original' })
    expect(page.messages[0]!.editedAt).toBeUndefined()
    expect(page.messages[0]!.deletedAt).toBeUndefined()
  })

  it('CONDITIONAL se trata como denegación y expone las condiciones', async () => {
    const module = await makeModule(
      fixedAuthorizer({ decision: 'CONDITIONAL', reason: 'mfa-required', conditions: ['require-mfa'] })
    )

    const err = await module
      .getOrCreateDirectConversation('user-b', A)
      .then(() => null)
      .catch((e: unknown) => e as PermissionDeniedError)
    expect(err).toBeInstanceOf(PermissionDeniedError)
    expect(err!.decision).toBe('CONDITIONAL')
    expect(err!.conditions).toEqual(['require-mfa'])
  })

  it('peticiones de autorización con permisos y recursos correctos', async () => {
    const spy = (req: AuthorizationRequestSpec) => requests.push(req)
    const module = await makeModule(fixedAuthorizer(ALLOW, spy))

    const dm = await module.getOrCreateDirectConversation('user-b', A)
    const message = await module.sendMessage(dm.conversationId, 'hola', A)
    await module.editMessage(message.messageId, 'hola!', A)
    await module.deleteMessage(message.messageId, A)
    await module.listConversations(A)
    await module.listMessages(dm.conversationId, {}, A)

    expect(requests.map((r) => r.permission)).toEqual([
      'msg:send', // crear DM
      'msg:send', // enviar
      'msg:edit', // editar
      'msg:delete', // borrar
      'msg:read', // listar conversaciones
      'msg:read', // listar mensajes
    ])
    expect(requests[0]!.resource).toMatchObject({ type: 'conversation' })
    expect(requests[1]!.resource).toMatchObject({ type: 'conversation', id: dm.conversationId })
    // ownerId del recurso = autor del mensaje (habilita las variantes -own)
    expect(requests[2]!.resource).toMatchObject({
      type: 'message',
      id: message.messageId,
      ownerId: 'user-a',
    })
    expect(requests[3]!.resource).toMatchObject({ ownerId: 'user-a' })
  })

  it('invariante de participantes independiente de roles: ALLOW no habilita a intrusos', async () => {
    const module = await makeModule(fixedAuthorizer(ALLOW))
    const dm = await module.getOrCreateDirectConversation('user-b', A)

    // C tiene permiso de rol (ALLOW) pero NO es participante ⇒ mismo error
    await expect(module.sendMessage(dm.conversationId, 'intruso', B)).resolves.toBeDefined() // B sí participa
    await expect(module.getConversation(dm.conversationId, MODERATOR)).rejects.toThrow(
      ConversationNotAccessibleError
    )
    await expect(module.listMessages(dm.conversationId, {}, MODERATOR)).rejects.toThrow(
      ConversationNotAccessibleError
    )
    await expect(
      module.createGroupConversation({ participantIds: ['user-b'] }, MODERATOR).then((g) =>
        module.sendMessage(g.conversationId, 'ok', MODERATOR)
      )
    ).resolves.toBeDefined() // si participa, ALLOW fluye
  })

  it('moderación: con authorizer, msg:delete pleno borra mensajes ajenos (aun sin participar)', async () => {
    const module = await makeModule(fixedAuthorizer(ALLOW)) // simula moderador/admin
    const dm = await module.getOrCreateDirectConversation('user-b', A)
    const message = await module.sendMessage(dm.conversationId, 'spam', A)

    // MODERATOR no participa de la DM pero tiene permiso pleno de borrado
    await module.deleteMessage(message.messageId, MODERATOR)

    const page = await module.listMessages(dm.conversationId, {}, A)
    expect(page.messages[0]).toMatchObject({ body: '', deletedAt: expect.any(Number) })
    const deleted = emitted.find((e) => e.name === 'msg:deleted')
    expect(deleted!.payload).toMatchObject({ deletedBy: 'user-mod' })
  })

  it('la edición es SIEMPRE del autor: ni un ALLOW de rol edita mensajes ajenos', async () => {
    const module = await makeModule(fixedAuthorizer(ALLOW))
    const group = await module.createGroupConversation(
      { participantIds: ['user-b', 'user-mod'] },
      A
    )
    const message = await module.sendMessage(group.conversationId, 'mío', A)

    await expect(module.editMessage(message.messageId, 'censura', MODERATOR)).rejects.toThrow(
      NotMessageAuthorError
    )
    const page = await module.listMessages(group.conversationId, {}, A)
    expect(page.messages[0]).toMatchObject({ body: 'mío' })
    expect(page.messages[0]!.editedAt).toBeUndefined()
  })
})
