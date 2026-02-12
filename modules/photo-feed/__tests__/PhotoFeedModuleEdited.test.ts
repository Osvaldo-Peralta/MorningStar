import { PhotoFeedModule } from "../PhotoFeedModule";
import { CoreContext } from "../../../core/context/CoreContext";
import { describe, it, expect } from "vitest";

describe('PhotoFeedModule - photo:edited', () => {
    it('emits photo:added and then photo:edited when a photo is edited', async () => {
        // Arrange
        const emittedEvents: any[] = []

        const mockContext = {
            events: {
                emit: (event: any) => {
                    emittedEvents.push(event)
                },
            },
        } as unknown as CoreContext
        
        const module = new PhotoFeedModule()
        await module.init(mockContext)

        // Acción 1: add photo
        module.addPhoto('photo-a.jpg')
        // Verificación de seguridad
        expect(emittedEvents).toHaveLength(1)
        expect(emittedEvents[0].name).toBe('photo:added')
        
        const addedEvent = emittedEvents[0]
        const photoId = addedEvent.payload.photoId

        // Acción 2: edit photo
        module.editPhoto(photoId, {url: 'photo-b.jpg'})
        // Assert: 2 eventos en total
        expect(emittedEvents).toHaveLength(2)

        const editedEvent = emittedEvents[1]
        // identidad de evento
        expect(editedEvent.name).toBe('photo:edited')
        expect(editedEvent.category).toBe('domain')

        // source
        expect(editedEvent.source).toEqual({
            moduleId: 'photo-feed',
            entity: 'photo',
            entityId: photoId,
        })

        // payload
        expect(editedEvent.payload.photoId).toBe(photoId)
        expect(editedEvent.payload.changes).toEqual({
            url: {
                before: 'photo-a.jpg',
                after: 'photo-b.jpg'
            },
        })

        // timestamp
        expect(typeof editedEvent.timestamp).toBe('number')
    })
})

// Caso: Multiples ediciones consecutivas
it('emits a photo:edited event for each consecutive valid edit', async () => {
  // Arrange
  const emittedEvents: any[] = []

  const mockContext = {
    events: {
      emit: (event: any) => emittedEvents.push(event),
    },
  } as any

  const module = new PhotoFeedModule()
  await module.init(mockContext)

  // --- Step 1: Add photo ---
  module.addPhoto('a.jpg')

  // Validamos que solo hay 1 evento
  expect(emittedEvents).toHaveLength(1)
  expect(emittedEvents[0].name).toBe('photo:added')

  const photoId = emittedEvents[0].payload.photoId

  // 🔥 Limpiamos eventos para aislar las ediciones
  emittedEvents.length = 0

  // --- Step 2: First edit (a → b) ---
  module.editPhoto(photoId, { url: 'b.jpg' })

  expect(emittedEvents).toHaveLength(1)

  expect(emittedEvents[0]).toMatchObject({
    name: 'photo:edited',
    payload: {
      photoId,
      changes: {
        url: {
          before: 'a.jpg',
          after: 'b.jpg',
        },
      },
    },
  })

  // 🔥 Limpiamos nuevamente
  emittedEvents.length = 0

  // --- Step 3: Second edit (b → c) ---
  module.editPhoto(photoId, { url: 'c.jpg' })

  expect(emittedEvents).toHaveLength(1)

  expect(emittedEvents[0]).toMatchObject({
    name: 'photo:edited',
    payload: {
      photoId,
      changes: {
        url: {
          before: 'b.jpg',
          after: 'c.jpg',
        },
      },
    },
  })
})

// Caso: contrato de prueba estricto del evento photo:edited
it('emits photo:edited with the exact expected contract shape', async () => {
  const emittedEvents: any[] = []

  const mockContext = {
    events: {
      emit: (event: any) => emittedEvents.push(event),
    },
  } as any

  const module = new PhotoFeedModule()
  await module.init(mockContext)

  module.addPhoto('original.jpg')
  const photoId = emittedEvents[0].payload.photoId

  module.editPhoto(photoId, { url: 'updated.jpg' })

  const editedEvent = emittedEvents[1]

  // Exact shape validation
  expect(Object.keys(editedEvent)).toEqual([
    'name',
    'category',
    'source',
    'payload',
    'timestamp',
  ])

  expect(editedEvent).toMatchObject({
    name: 'photo:edited',
    category: 'domain',
    source: {
      moduleId: 'photo-feed',
      entity: 'photo',
      entityId: photoId,
    },
    payload: {
      photoId,
      changes: {
        url: {
          before: 'original.jpg',
          after: 'updated.jpg',
        },
      },
    },
  })

  expect(typeof editedEvent.timestamp).toBe('number')
})

// Caso: integracion simple con RuntimeLoggerModule
it('can be consumed by a listener without errors', async () => {
  const listeners: any[] = []

  const mockContext = {
    events: {
      emit: (event: any) => {
        // simulate a logger or subscriber
        listeners.push(event)
      },
    },
  } as any

  const module = new PhotoFeedModule()
  await module.init(mockContext)

  module.addPhoto('x.jpg')
  const photoId = listeners[0].payload.photoId

  module.editPhoto(photoId, { url: 'y.jpg' })

  const editedEvent = listeners[1]

  // simulate consumer access
  expect(() => {
    const { before, after } = editedEvent.payload.changes.url
    return before && after
  }).not.toThrow()
})
