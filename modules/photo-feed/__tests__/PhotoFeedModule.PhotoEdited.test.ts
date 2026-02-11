import { PhotoFeedModule } from "../PhotoFeedModule"

// Caso -> No emitir 'photo:edited' si no hay cambios reales
it ('does NOT emit photo:edited if edit does not change anything', async () => {
    const emittedEvents: any[] = []

    const mockContext = {
        events: {
            emit: (event: any) => emittedEvents.push(event),
        },
    } as any

    const module = new PhotoFeedModule()
    await module.init(mockContext)

    // Añadir foto
    module.addPhoto('photo-a.jpg')
    const photoId = emittedEvents[0].payload.photoId

    // Acción: editar usando la misma URL
    module.editPhoto(photoId, {url: 'photo-a.jpg'})

    // Coincidencia
    expect(emittedEvents).toHaveLength(1)
    expect(emittedEvents[0].name).toBe('photo:added')
})

// Caso -> Error si se intenta editar una foto inexistente
it('throws an error when trying to edit a non-existing photo', async () => {
  // Arrange
  const mockContext = {
    events: {
      emit: vitest.fn(),
    },
  } as any

  const module = new PhotoFeedModule()
  await module.init(mockContext)

  // Act + Assert
  expect(() =>
    module.editPhoto('non-existent-id', { url: 'x.jpg' })
  ).toThrow('Photo non-existent-id not found')
})

// Caso -> Orden correcto de eventos (added -> edited)
it('emits events in the correct order: photo:added → photo:edited', async () => {
  // Arrange
  const emittedEvents: any[] = []

  const mockContext = {
    events: {
      emit: (event: any) => emittedEvents.push(event),
    },
  } as any

  const module = new PhotoFeedModule()
  await module.init(mockContext)

  // Act
  module.addPhoto('photo-a.jpg')
  const photoId = emittedEvents[0].payload.photoId

  module.editPhoto(photoId, { url: 'photo-b.jpg' })

  // Assert
  expect(emittedEvents.map(e => e.name)).toEqual([
    'photo:added',
    'photo:edited',
  ])
})
