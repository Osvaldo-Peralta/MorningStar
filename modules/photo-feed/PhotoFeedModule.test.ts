import { describe, it, expect, beforeEach } from 'vitest'
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

    module.addPhoto('photo-1')
    module.addPhoto('photo-2')

    expect(module.listPhotos()).toEqual(['photo-1', 'photo-2'])
  })
})
