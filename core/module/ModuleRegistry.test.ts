// Creo que esto en realidad iba en los test para ModuleLifecycle
import { AppModule } from './AppModule'
import { ModuleState } from './ModuleState'
import { ModuleRegistry } from "./ModuleRegistry"
import { createMockeCoreContext } from './__mocks__/coreContext'

export const createMockModule = (id = 'test-module'): AppModule => ({
  id,
  version: '1.0.0',
  state: ModuleState.Registered,

  init: vi.fn(),
  activate: vi.fn(),
  deactivate: vi.fn(),
  dispose: vi.fn()
})

// Registrar modulo
it('registers a module with Registered state', () => {
    const registry = new ModuleRegistry(createMockeCoreContext())
    const module = createMockModule()

    registry.register(module)
    expect(module.state).toBe(ModuleState.Registered)
})

// Test no permite un doble registro
it('throws if module is already registered', () => {
  const registry = new ModuleRegistry(createMockeCoreContext())
  const module = createMockModule()

  registry.register(module)

  expect(() => registry.register(module)).toThrow()
})

// init valido
it('initializes a registered module', async () => {
  const registry = new ModuleRegistry(createMockeCoreContext())
  const module = createMockModule()

  registry.register(module)
  await registry.init(module.id)

  expect(module.init).toHaveBeenCalledOnce()
  expect(module.state).toBe(ModuleState.Initialized)
})

// test transición invalida
it('throws if init is called in invalid state', async () => {
  const registry = new ModuleRegistry(createMockeCoreContext())
  const module = createMockModule()

  registry.register(module)
  await registry.init(module.id)

  await expect(registry.init(module.id)).rejects.toThrow()
})

//activate → deactivate → dispose
it('full lifecycle works correctly', async () => {
  const registry = new ModuleRegistry(createMockeCoreContext())
  const module = createMockModule()

  registry.register(module)
  await registry.init(module.id)
  await registry.activate(module.id)
  await registry.deactivate(module.id)
  await registry.dispose(module.id)

  expect(module.activate).toHaveBeenCalledOnce()
  expect(module.deactivate).toHaveBeenCalledOnce()
  expect(module.dispose).toHaveBeenCalledOnce()
})

//