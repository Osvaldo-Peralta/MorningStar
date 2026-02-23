import { describe, it, expect, vitest } from 'vitest'
import { PhotoFeedModule } from '../PhotoFeedModule'
import { ModuleRegistry } from '../../../core/module'
import { createMockCoreContext } from '../../../core/module/__mocks__/mockCoreContext'

describe('PhotoFeedModule', () => {
  it('adds and lists photos', async () => {
    const context = createMockCoreContext()
    const registry = new ModuleRegistry(context)
    const module = new PhotoFeedModule()

    registry.register(module)
    await registry.init(module.id)
    await registry.activate(module.id)

    await module.addPhoto('http://photo-1.jpg')
    await module.addPhoto('http://photo-2.jpg')
    
    // Corregido el typo 'lisEntries' -> 'listEntries'
    const photos = module.listEntries()

    // Verificamos que se han añadido 2 elementos
    expect(photos).toHaveLength(2)
    
    // Verificamos el contenido mapeando solo las URLs para la comparación
    expect(photos.map(p => p.url)).toEqual(['http://photo-1.jpg', 'http://photo-2.jpg'])
    
    // Opcional: Verificar que tienen IDs generados
    expect(photos[0].id).toBeDefined()
  })
})

it('removes a photo and emits the corresponding event', async () => {
  const context = createMockCoreContext()
  const module = new PhotoFeedModule()
  
  // Espía para el bus de eventos
  const eventSpy = vitest.spyOn(context.events, 'emit')
  
  await module.init(context)

  // 1. Preparación: Añadir una foto
  await module.addPhoto('http://test-to-remove.jpg')
  const photoId = module.listEntries()[0].id

  // 2. Acción: Eliminar
  await module.removePhoto(photoId)

  // 3. Verificación de Estado (Queries)
  const remainingPhotos = module.listEntries()
  expect(remainingPhotos).toHaveLength(0)

  // 4. Verificación de Eventos (Contrato de comunicación)
  expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
    name: 'photo:removed',
    payload: expect.objectContaining({
      photoId: photoId
    })
  }))
})

it('throws an error when trying to remove a non-existent photo', async () => {
  const context = createMockCoreContext()
  const module = new PhotoFeedModule()
  await module.init(context)

  // Intentar borrar un ID que no existe debe fallar según la lógica del Service
  await expect(module.removePhoto('invalid-id'))
    .rejects.toThrow('Photo invalid-id not found')
})

/* ----- Test de integracióon para editPhoto -----*/

it('should edit a photo and emit photo:edited event', async () => {
  const context = createMockCoreContext()
  const module = new PhotoFeedModule()
  
  // Espía para verificar la comunicación del sistema
  const eventSpy = vitest.spyOn(context.events, 'emit')
  
  await module.init(context)

  // 1. Preparación: Añadir una foto inicial
  const oldUrl = 'http://old-url.com/image.jpg'
  await module.addPhoto(oldUrl)
  const photoId = module.listEntries()[0].id

  // 2. Acción: Editar la URL
  const newUrl = 'http://new-url.com/updated.jpg'
  await module.editPhoto(photoId, { url: newUrl })

  // 3. Verificación de Estado (Query)
  const photos = module.listEntries()
  expect(photos[0].url).toBe(newUrl)

  // 4. Verificación de Contrato (Evento) - CORREGIDO
  expect(eventSpy).toHaveBeenCalledWith(expect.objectContaining({
    name: 'photo:edited',
    payload: expect.objectContaining({
      photoId: photoId,
      changes: {
        url: {
          before: oldUrl,
          after: newUrl
        }
      }
    })
  }))
})