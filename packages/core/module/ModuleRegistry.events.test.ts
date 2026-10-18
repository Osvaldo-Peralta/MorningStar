// core/module/ModuleRegistry.events.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ModuleRegistry } from './ModuleRegistry.js'
import { ModuleEvents } from '../context/events.js'
import { createMockCoreContext } from './__mocks__/mockCoreContext.js'
import { createMockModule } from './__mocks__/mockModule.js'
describe('ModuleRegistry EventBus integration', () => {
  it('emits events on lifecycle transitions', async () => {
    const context = createMockCoreContext()
    const spy = vi.fn()

    context.events.on(ModuleEvents.ACTIVATED, spy)

    const registry = new ModuleRegistry(context)
    const module = createMockModule()

    registry.register(module)
    await registry.init(module.id)
    await registry.activate(module.id)

  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({
      name: ModuleEvents.ACTIVATED,
      category: 'lifecycle',
      payload: { moduleId: module.id },
      source: { moduleId: module.id },
      timestamp: expect.any(Number)
    })
  )
  })
})
