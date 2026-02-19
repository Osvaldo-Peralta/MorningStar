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

    // URLs con prefijo http para pasar la validación
    await module.addPhoto('http://photo-1.jpg')
    await module.addPhoto('http://photo-2.jpg')
    
    const photos = module.listPhotos()

    expect(photos).toEqual(['http://photo-1.jpg', 'http://photo-2.jpg'])
  })
})