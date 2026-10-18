// Pruebas de la persistencia con identidad estable (Fase 1 / ADR-0003)
import { describe, it, expect, vi } from 'vitest'
import { PhotoFeedModule } from '../PhotoFeedModule.js'
import { Photo } from '../domain/Photo.js'
import {
  InMemoryEventBus,
  InMemoryPersistenceAdapter,
} from '@morningstar/core'
import type { CoreContext, CoreEventMap, Storage } from '@morningstar/core'

const nullStorage: Storage = {
  get: async () => null,
  set: async () => {},
  remove: async () => {},
  exists: async () => false,
}

const makeContext = (
  persistence?: InMemoryPersistenceAdapter,
  storage: Storage = nullStorage
): CoreContext<CoreEventMap> => ({
  events: new InMemoryEventBus<CoreEventMap>(),
  storage,
  ...(persistence ? { persistence } : {}),
  permission: { has: () => true, request: async () => true },
  logger: console,
  config: { environment: 'test', version: '0.0.0' },
})

describe('PhotoFeedModule — persistencia con identidad estable', () => {
  it('los photoId y timestamps sobreviven a una reinicialización', async () => {
    const persistence = new InMemoryPersistenceAdapter()

    const first = new PhotoFeedModule()
    await first.init(makeContext(persistence))
    await first.addPhoto('http://estable.jpg')
    const [original] = first.listEntries()
    await first.dispose()

    // "Nueva sesión": mismo provider (mismo almacén), módulo nuevo
    const second = new PhotoFeedModule()
    await second.init(makeContext(persistence))
    const [rehydrated] = second.listEntries()

    expect(rehydrated.id).toBe(original.id)
    expect(rehydrated.url).toBe(original.url)
    expect(rehydrated.createdAt).toBe(original.createdAt)
    expect(rehydrated.updatedAt).toBe(original.updatedAt)
  })

  it('las ediciones y eliminaciones persisten en el repositorio', async () => {
    const persistence = new InMemoryPersistenceAdapter()

    const first = new PhotoFeedModule()
    await first.init(makeContext(persistence))
    await first.addPhoto('http://a.jpg')
    const photoId = first.listEntries()[0].id
    await first.editPhoto(photoId, { url: 'http://b.jpg' })
    await first.dispose()

    const second = new PhotoFeedModule()
    await second.init(makeContext(persistence))
    expect(second.listEntries().map((p) => p.url)).toEqual(['http://b.jpg'])

    await second.removePhoto(photoId)
    await second.dispose()

    const third = new PhotoFeedModule()
    await third.init(makeContext(persistence))
    expect(third.listEntries()).toHaveLength(0)
  })

  it("init falla con error explícito si falta context.persistence", async () => {
    const module = new PhotoFeedModule()
    await expect(module.init(makeContext(undefined))).rejects.toThrow(/persistence/)
  })

  it('migra por única vez las URLs legacy del Storage y descarta la clave vieja', async () => {
    const persistence = new InMemoryPersistenceAdapter()
    const removeSpy = vi.fn(async () => {})
    const legacyStorage: Storage = {
      get: async (key) => (key === 'photo-feed:data' ? ['http://legacy.jpg'] : null),
      set: async () => {},
      remove: removeSpy,
      exists: async () => false,
    }

    const first = new PhotoFeedModule()
    await first.init(makeContext(persistence, legacyStorage))

    const photos = first.listEntries()
    expect(photos).toHaveLength(1)
    expect(photos[0].url).toBe('http://legacy.jpg')
    expect(removeSpy).toHaveBeenCalledWith('photo-feed:data')
    await first.dispose()

    // Segunda sesión con el mismo almacén legacy "presente" (el stub siempre
    // lo devuelve): NO debe duplicar porque el repositorio ya tiene datos
    const second = new PhotoFeedModule()
    await second.init(makeContext(persistence, legacyStorage))
    expect(second.listEntries()).toHaveLength(1)
  })

  it('Photo.toRecord/fromRecord hace roundtrip preservando identidad', () => {
    const photo = new Photo('id-1', 'http://url-1.jpg')
    photo.edit({ url: 'http://url-2.jpg' })

    const record = photo.toRecord()
    expect(record).toEqual({
      id: 'id-1',
      url: 'http://url-2.jpg',
      createdAt: photo.createdAt,
      updatedAt: photo.updatedAt,
    })

    const restored = Photo.fromRecord(record)
    expect(restored.id).toBe(photo.id)
    expect(restored.url).toBe('http://url-2.jpg')
    expect(restored.createdAt).toBe(photo.createdAt)
    expect(restored.updatedAt).toBe(photo.updatedAt)
  })
})
