// Pruebas de subida de archivos y separación metadata/binario (Fase 2 / ADR-0004)
import { describe, it, expect } from 'vitest'
import { PhotoFeedModule } from '../PhotoFeedModule.js'
import { PHOTO_MEDIA_POLICY } from '../domain/mediaPolicy.js'
import {
  InMemoryEventBus,
  InMemoryMediaStorage,
  InMemoryPersistenceAdapter,
} from '@morningstar/core'
import type { CoreContext, CoreEventMap, MediaStorage, Storage } from '@morningstar/core'

const nullStorage: Storage = {
  get: async () => null,
  set: async () => {},
  remove: async () => {},
  exists: async () => false,
}

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a])

interface Fixture {
  module: PhotoFeedModule
  context: CoreContext<CoreEventMap>
  persistence: InMemoryPersistenceAdapter
  media: InMemoryMediaStorage
  emitted: Array<{ name: string; payload: Record<string, unknown> }>
}

const makeFixture = async (options?: { withMedia?: boolean }): Promise<Fixture> => {
  const persistence = new InMemoryPersistenceAdapter()
  const media = new InMemoryMediaStorage()
  const emitted: Fixture['emitted'] = []

  const context = {
    events: new InMemoryEventBus<CoreEventMap>(),
    storage: nullStorage,
    persistence,
    ...(options?.withMedia === false ? {} : { media }),
    permission: { has: () => true, request: async () => true },
    logger: console,
    config: { environment: 'test', version: '0.0.0' },
  } as CoreContext<CoreEventMap>

  ;(context.events as unknown as { on: (n: string, h: (e: never) => void) => unknown }).on?.(
    '*',
    (event) => emitted.push(event as never)
  )

  const module = new PhotoFeedModule()
  await module.init(context)

  return { module, context, persistence, media, emitted }
}

describe('PhotoFeedModule — subida de archivos (Fase 2)', () => {
  it('addPhotoFromFile almacena binario, metadata y emite photo:added con media', async () => {
    const fixture = await makeFixture()

    await fixture.module.addPhotoFromFile({ data: PNG_BYTES, mimeType: 'image/png' })

    const photos = fixture.module.listEntries()
    expect(photos).toHaveLength(1)
    expect(photos[0].media).toEqual({
      mediaId: expect.any(String),
      mimeType: 'image/png',
      size: PNG_BYTES.byteLength,
    })
    // URI de sesión resuelta (data: URL en el adaptador InMemory)
    expect(photos[0].url.startsWith('data:image/png')).toBe(true)

    // Los bytes viven SOLO en el puerto de medios
    const bytes = await fixture.media.get(photos[0].media!.mediaId)
    expect(Array.from(bytes!)).toEqual(Array.from(PNG_BYTES))

    // El record persistido guarda la referencia, no la URI ni los bytes
    const repo = fixture.persistence.repository<{ id: string; media?: unknown; url?: string }>(
      'photo-feed:photos'
    )
    const [record] = await repo.list()
    expect(record.media).toBeDefined()
    expect(record.url).toBeUndefined()

    // Evento con campo aditivo media (ADR-0001, sigue siendo v1)
    const added = fixture.emitted.find((e) => e.name === 'photo:added')
    expect(added?.payload).toMatchObject({
      photoId: photos[0].id,
      media: { mediaId: photos[0].media!.mediaId, mimeType: 'image/png' },
    })
  })

  it('rechaza MIME no permitido sin efectos colaterales', async () => {
    const fixture = await makeFixture()

    await expect(
      fixture.module.addPhotoFromFile({ data: PNG_BYTES, mimeType: 'image/tiff' })
    ).rejects.toThrow(/Unsupported media type/)

    expect(fixture.module.listEntries()).toHaveLength(0)
  })

  it('rechaza archivos vacíos', async () => {
    const fixture = await makeFixture()

    await expect(
      fixture.module.addPhotoFromFile({ data: new Uint8Array(0), mimeType: 'image/png' })
    ).rejects.toThrow(/empty/i)
  })

  it('rechaza archivos que exceden el tamaño máximo', async () => {
    const fixture = await makeFixture()
    const oversized = new Uint8Array(PHOTO_MEDIA_POLICY.maxBytes + 1)

    await expect(
      fixture.module.addPhotoFromFile({ data: oversized, mimeType: 'image/jpeg' })
    ).rejects.toThrow(/too large/i)

    expect(fixture.module.listEntries()).toHaveLength(0)
  })

  it("addPhotoFromFile falla con error explícito si falta context.media", async () => {
    const fixture = await makeFixture({ withMedia: false })

    await expect(
      fixture.module.addPhotoFromFile({ data: PNG_BYTES, mimeType: 'image/png' })
    ).rejects.toThrow(/context\.media/)
  })

  it('removePhoto limpia también el binario del MediaStorage', async () => {
    const fixture = await makeFixture()
    await fixture.module.addPhotoFromFile({ data: PNG_BYTES, mimeType: 'image/png' })
    const photo = fixture.module.listEntries()[0]
    const mediaId = photo.media!.mediaId

    await fixture.module.removePhoto(photo.id)

    expect(await fixture.media.get(mediaId)).toBeNull()
    expect(fixture.module.listEntries()).toHaveLength(0)
  })

  it('rehidrata fotos con media preservando identidad y re-resolviendo la URI', async () => {
    const persistence = new InMemoryPersistenceAdapter()
    const media: MediaStorage = new InMemoryMediaStorage()

    const first = new PhotoFeedModule()
    await first.init({
      events: new InMemoryEventBus<CoreEventMap>(),
      storage: nullStorage,
      persistence,
      media,
      permission: { has: () => true, request: async () => true },
      logger: console,
      config: { environment: 'test', version: '0.0.0' },
    } as CoreContext<CoreEventMap>)
    await first.addPhotoFromFile({ data: PNG_BYTES, mimeType: 'image/png' })
    const [original] = first.listEntries()
    await first.dispose()

    // "Nueva sesión": mismos almacenes, módulo nuevo
    const second = new PhotoFeedModule()
    await second.init({
      events: new InMemoryEventBus<CoreEventMap>(),
      storage: nullStorage,
      persistence,
      media,
      permission: { has: () => true, request: async () => true },
      logger: console,
      config: { environment: 'test', version: '0.0.0' },
    } as CoreContext<CoreEventMap>)

    const [rehydrated] = second.listEntries()
    expect(rehydrated.id).toBe(original.id)
    expect(rehydrated.createdAt).toBe(original.createdAt)
    expect(rehydrated.media).toEqual(original.media)
    expect(rehydrated.url.startsWith('data:image/png')).toBe(true)
  })

  it('media huérfana: la foto se conserva con URI vacía', async () => {
    const persistence = new InMemoryPersistenceAdapter()
    const media = new InMemoryMediaStorage()

    const first = new PhotoFeedModule()
    await first.init({
      events: new InMemoryEventBus<CoreEventMap>(),
      storage: nullStorage,
      persistence,
      media,
      permission: { has: () => true, request: async () => true },
      logger: console,
      config: { environment: 'test', version: '0.0.0' },
    } as CoreContext<CoreEventMap>)
    await first.addPhotoFromFile({ data: PNG_BYTES, mimeType: 'image/png' })
    const photoId = first.listEntries()[0].id
    const mediaId = first.listEntries()[0].media!.mediaId
    await first.dispose()

    // Simulamos pérdida del binario (bytes borrados, metadata intacta)
    await media.remove(mediaId)

    const second = new PhotoFeedModule()
    await second.init({
      events: new InMemoryEventBus<CoreEventMap>(),
      storage: nullStorage,
      persistence,
      media,
      permission: { has: () => true, request: async () => true },
      logger: console,
      config: { environment: 'test', version: '0.0.0' },
    } as CoreContext<CoreEventMap>)

    const [orphan] = second.listEntries()
    expect(orphan.id).toBe(photoId)
    expect(orphan.url).toBe('')
    expect(orphan.media?.mediaId).toBe(mediaId)
  })

  it('editPhoto sobre una foto con media lanza error explícito (limitación documentada)', async () => {
    const fixture = await makeFixture()
    await fixture.module.addPhotoFromFile({ data: PNG_BYTES, mimeType: 'image/png' })
    const photoId = fixture.module.listEntries()[0].id

    await expect(
      fixture.module.editPhoto(photoId, { url: 'http://otro.jpg' })
    ).rejects.toThrow(/not supported/i)
  })
})
