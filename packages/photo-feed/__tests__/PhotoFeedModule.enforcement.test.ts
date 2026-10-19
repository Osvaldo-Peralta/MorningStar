// Enforcement de autorización en photo-feed (ADR-0012): fail-closed, ownerId, cero efectos en DENY
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PhotoFeedModule } from '../PhotoFeedModule.js'
import { Photo } from '../domain/Photo.js'
import { PermissionDeniedError, PermissionRequiredError } from '../errors.js'
import {
  InMemoryEventBus,
  InMemoryMediaStorage,
  InMemoryPersistenceAdapter,
} from '@morningstar/core'
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

const ACTOR: ActorContext = { sessionToken: 'token-valida', userId: 'user-42' }
const OTHER_ACTOR: ActorContext = { sessionToken: 'token-valida', userId: 'user-99' }

const fixedAuthorizer = (
  decision: AuthorizationDecisionSpec,
  spy?: (req: AuthorizationRequestSpec, sessionToken: string) => void
): Authorizer => ({
  authorize: async (request, sessionToken) => {
    spy?.(request, sessionToken)
    return decision
  },
})

describe('PhotoFeedModule — enforcement de autorización (ADR-0012)', () => {
  let persistence: InMemoryPersistenceAdapter
  let media: InMemoryMediaStorage
  let bus: InMemoryEventBus<CoreEventMap>
  let emitted: DomainEvent<unknown>[]
  let requests: AuthorizationRequestSpec[]

  const makeModule = async (authorizer?: Authorizer): Promise<PhotoFeedModule> => {
    const module = new PhotoFeedModule()
    await module.init({
      events: bus,
      storage: nullStorage,
      persistence,
      media,
      authorizer,
      permission: { has: () => true, request: async () => true },
      logger: console,
      config: { environment: 'test', version: '0.0.0' },
    } as CoreContext<CoreEventMap>)
    return module
  }

  beforeEach(() => {
    persistence = new InMemoryPersistenceAdapter()
    media = new InMemoryMediaStorage()
    bus = new InMemoryEventBus<CoreEventMap>()
    emitted = []
    requests = []
    bus.on('*', (event) => emitted.push(event))
  })

  it('sin authorizer: comportamiento actual, sin actor (regresión de compatibilidad)', async () => {
    const module = await makeModule(undefined)
    await module.addPhoto('http://sin-autorizacion.jpg')
    expect(module.listEntries()).toHaveLength(1)
    expect(module.listEntries()[0].ownerId).toBeUndefined()
  })

  it('con authorizer y sin actor: fail-closed en los 4 comandos', async () => {
    const module = await makeModule(fixedAuthorizer({ decision: 'ALLOW', reason: 'role:member' }))

    await expect(module.addPhoto('http://a.jpg')).rejects.toThrow(PermissionRequiredError)
    await expect(
      module.addPhotoFromFile({ data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' })
    ).rejects.toThrow(PermissionRequiredError)
    await expect(module.editPhoto('cualquiera', { url: 'http://x.jpg' })).rejects.toThrow(
      PermissionRequiredError
    )
    await expect(module.removePhoto('cualquiera')).rejects.toThrow(PermissionRequiredError)

    // Cero efectos colaterales
    expect(module.listEntries()).toHaveLength(0)
    expect(emitted).toHaveLength(0)
  })

  it('ALLOW: la operación procede y stampea ownerId = actor.userId', async () => {
    const module = await makeModule(fixedAuthorizer({ decision: 'ALLOW', reason: 'role:member' }))

    await module.addPhoto('http://con-dueno.jpg', ACTOR)

    const [photo] = module.listEntries()
    expect(photo.ownerId).toBe('user-42')

    const added = emitted.find((e) => e.name === 'photo:added')
    expect(added?.payload).toMatchObject({ ownerId: 'user-42' })
  })

  it('DENY: PermissionDeniedError con reason y CERO efectos colaterales', async () => {
    const module = await makeModule(
      fixedAuthorizer({ decision: 'DENY', reason: 'no-role-grants-permission' })
    )

    const error = await module.addPhoto('http://denegada.jpg', ACTOR).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PermissionDeniedError)
    expect((error as PermissionDeniedError).decision).toBe('DENY')
    expect((error as PermissionDeniedError).reason).toBe('no-role-grants-permission')

    expect(module.listEntries()).toHaveLength(0)
    expect(emitted).toHaveLength(0)
    expect(await persistence.repository('photo-feed:photos').list()).toHaveLength(0)
  })

  it('CONDITIONAL: se trata como denegación exponiendo las condiciones', async () => {
    const module = await makeModule(
      fixedAuthorizer({ decision: 'CONDITIONAL', reason: 'sensitive-permission', conditions: ['require-mfa'] })
    )

    const error = await module.addPhoto('http://condicional.jpg', ACTOR).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PermissionDeniedError)
    expect((error as PermissionDeniedError).decision).toBe('CONDITIONAL')
    expect((error as PermissionDeniedError).conditions).toEqual(['require-mfa'])
    expect(module.listEntries()).toHaveLength(0)
  })

  it('editPhoto pasa el recurso con ownerId al authorizer', async () => {
    const spy = vi.fn()
    const module = await makeModule(fixedAuthorizer({ decision: 'ALLOW', reason: 'role:member' }, spy))

    await module.addPhoto('http://editable.jpg', ACTOR)
    const photoId = module.listEntries()[0].id
    spy.mockClear()

    await module.editPhoto(photoId, { url: 'http://editada.jpg' }, ACTOR)

    expect(spy).toHaveBeenCalledWith(
      { permission: 'photo:edit', resource: { type: 'photo', id: photoId, ownerId: 'user-42' } },
      ACTOR.sessionToken
    )
  })

  it('removePhoto pasa el recurso con ownerId y respeta el orden enforcement → dominio', async () => {
    const spy = vi.fn()
    const module = await makeModule(fixedAuthorizer({ decision: 'ALLOW', reason: 'role:member' }, spy))

    await module.addPhoto('http://borrable.jpg', ACTOR)
    const photoId = module.listEntries()[0].id
    spy.mockClear()

    await module.removePhoto(photoId, ACTOR)
    expect(spy).toHaveBeenCalledWith(
      { permission: 'photo:delete', resource: { type: 'photo', id: photoId, ownerId: 'user-42' } },
      ACTOR.sessionToken
    )
    expect(module.listEntries()).toHaveLength(0)
  })

  it('addPhotoFromFile: DENY no almacena el binario', async () => {
    const module = await makeModule(fixedAuthorizer({ decision: 'DENY', reason: 'no-role-grants-permission' }))

    await expect(
      module.addPhotoFromFile({ data: new Uint8Array([0x89, 0x50]), mimeType: 'image/png' }, ACTOR)
    ).rejects.toThrow(PermissionDeniedError)

    // El MediaStorage quedó intacto: el binario nunca se guardó
    const orphanCheck = await module.listEntries()
    expect(orphanCheck).toHaveLength(0)
  })

  it('foto legacy sin dueño: el recurso viaja con ownerId undefined', async () => {
    // Se crea sin authorizer (comportamiento legacy)...
    const legacy = await makeModule(undefined)
    await legacy.addPhoto('http://legacy.jpg')
    const photoId = legacy.listEntries()[0].id

    // ...y se opera con authorizer activo: el recurso no puede probar propiedad
    const spy = vi.fn()
    const enforced = await makeModule(fixedAuthorizer({ decision: 'DENY', reason: 'no-role-grants-permission' }, spy))
    await expect(enforced.editPhoto(photoId, { url: 'http://x.jpg' }, OTHER_ACTOR)).rejects.toThrow(
      PermissionDeniedError
    )
    expect(spy).toHaveBeenCalledWith(
      { permission: 'photo:edit', resource: { type: 'photo', id: photoId, ownerId: undefined } },
      OTHER_ACTOR.sessionToken
    )
  })

  it('Photo: ownerId en constructor, toRecord y fromRecord', () => {
    const photo = new Photo('p1', 'http://a.jpg', undefined, 'user-42')
    expect(photo.ownerId).toBe('user-42')

    const record = photo.toRecord()
    expect(record).toMatchObject({ id: 'p1', url: 'http://a.jpg', ownerId: 'user-42' })

    const restored = Photo.fromRecord(record)
    expect(restored.ownerId).toBe('user-42')

    // Sin owner: la clave no aparece en el record
    const anonymous = new Photo('p2', 'http://b.jpg')
    expect('ownerId' in anonymous.toRecord()).toBe(false)
  })
})
