// core/module/ModuleRegistry.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ModuleRegistry } from './ModuleRegistry'
import { ModuleState } from './ModuleState'
import {
  ModuleAlreadyRegisteredError,
  InvalidModuleStateError
} from './errors'
import { createMockCoreContext } from './__mocks__/mockCoreContext'
import { createMockModule } from './__mocks__/mockModule'

describe('ModuleRegistry', () => {
  let registry: ModuleRegistry

  beforeEach(() => {
    registry = new ModuleRegistry(createMockCoreContext())
  })

  it('registers a module correctly', () => {
    const module = createMockModule()

    registry.register(module)

    expect(module.state).toBe(ModuleState.Registered)
    expect(registry.list()).toHaveLength(1)
  })

  it('throws if module is registered twice', () => {
    const module = createMockModule()

    registry.register(module)

    expect(() => registry.register(module)).toThrow(
      ModuleAlreadyRegisteredError
    )
  })

  it('initializes a registered module', async () => {
    const module = createMockModule()
    const initSpy = vi.spyOn(module, 'init')

    registry.register(module)
    await registry.init(module.id)

    expect(initSpy).toHaveBeenCalled()
    expect(module.state).toBe(ModuleState.Initialized)
  })

  it('prevents activating a non-initialized module', async () => {
    const module = createMockModule()

    registry.register(module)

    await expect(registry.activate(module.id)).rejects.toThrow(
      InvalidModuleStateError
    )
  })

  it('activates an initialized module', async () => {
    const module = createMockModule()

    registry.register(module)
    await registry.init(module.id)
    await registry.activate(module.id)

    expect(module.state).toBe(ModuleState.Active)
  })

  it('deactivates an active module', async () => {
    const module = createMockModule()

    registry.register(module)
    await registry.init(module.id)
    await registry.activate(module.id)
    await registry.deactivate(module.id)

    expect(module.state).toBe(ModuleState.Inactive)
  })

  it('disposes a module correctly', async () => {
    const module = createMockModule()

    registry.register(module)
    await registry.init(module.id)
    await registry.dispose(module.id)

    expect(module.state).toBe(ModuleState.Disposed)
    expect(registry.list()).toHaveLength(0)
  })
})
