import { describe, it, expect } from 'vitest'
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