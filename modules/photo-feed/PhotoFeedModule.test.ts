import { describe, it, expect } from 'vitest'
import { PhotoFeedModule } from './PhotoFeedModule'
import { ModuleRegistry } from '../../core/module/ModuleRegistry'
import { createMockCoreContext } from '../../core/module/__mocks__/mockCoreContext'

describe('PhotoFeedModule', () => {
  it('adds and lists photos', async () => {
    const context = createMockCoreContext()
    const registry = new ModuleRegistry(context)

    const module = new PhotoFeedModule()

    registry.register(module)
    await registry.init(module.id)
    await registry.activate(module.id)

    const service = module.getService()

    service.addPhoto('photo-1')
    service.addPhoto('photo-2')

    expect(service.listPhotos()).toEqual(['photo-1', 'photo-2'])
  })
})
