import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ModuleRegistry } from './ModuleRegistry.js'
import { ModuleState } from './ModuleState.js'
import { createMockCoreContext } from './__mocks__/mockCoreContext.js'
import { createMockModule } from './__mocks__/mockModule.js'

describe('ModuleRegistry lifecycle failures', () => {
  let registry: ModuleRegistry

  beforeEach(() => {
    registry = new ModuleRegistry(createMockCoreContext())
  })

  it('keeps state when init fails', async () => {
    const module = createMockModule()
    module.init = vi.fn(async () => {
      throw new Error('init failed')
    })

    registry.register(module)

    await expect(registry.init(module.id)).rejects.toMatchObject({
      name: 'ModuleLifecycleError'
    })

    expect(module.state).toBe(ModuleState.Registered)
  })

  it('keeps state when activate fails', async () => {
    const module = createMockModule()
    module.activate = vi.fn(async () => {
      throw new Error('activate failed')
    })

    registry.register(module)
    await registry.init(module.id)

    await expect(registry.activate(module.id)).rejects.toMatchObject({
      name: 'ModuleLifecycleError'
    })

    expect(module.state).toBe(ModuleState.Initialized)
  })

  it('keeps state when deactivate fails', async () => {
    const module = createMockModule()
    module.deactivate = vi.fn(async () => {
      throw new Error('deactivate failed')
    })

    registry.register(module)
    await registry.init(module.id)
    await registry.activate(module.id)

    await expect(registry.deactivate(module.id)).rejects.toMatchObject({
      name: 'ModuleLifecycleError'
    })

    expect(module.state).toBe(ModuleState.Active)
  })

  it('does not dispose module when dispose fails', async () => {
    const module = createMockModule()
    module.dispose = vi.fn(async () => {
      throw new Error('dispose failed')
    })

    registry.register(module)
    await registry.init(module.id)

    await expect(registry.dispose(module.id)).rejects.toMatchObject({
      name: 'ModuleLifecycleError'
    })

    expect(module.state).toBe(ModuleState.Initialized)
    expect(registry.list()).toHaveLength(1)
  })
})
