import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RuntimeLoggerModule } from './RuntimeLoggerModule' // Ajusta la ruta
import { InMemoryEventBus, ModuleRegistry, CoreContext } from '@morningstar/core'

describe('RuntimeLoggerModule', () => {
  // Tipado correcto para los spys de Vitest
  let logSpy: import('vitest').MockInstance
  let errorSpy: import('vitest').MockInstance

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createContext(): CoreContext {
    return {
      events: new InMemoryEventBus(),
      storage: {} as any,
      permission: {} as any,
      logger: console,
      config: {
        environment: 'test',
        version: '0.0.0-test',
      },
    }
  }

  it('logs lifecycle events', async () => {
    const context = createContext()
    const registry = new ModuleRegistry(context)
    const logger = new RuntimeLoggerModule()

    registry.register(logger)
    await registry.init(logger.id)
    await registry.activate(logger.id)

    expect(logSpy).toHaveBeenCalled()
    // Solución TS7006: Tipar 'call' como string[] o usar unknown[]
    expect(
      logSpy.mock.calls.some((call: unknown[]) => 
        String(call[0]).includes('[LIFECYCLE]')
      )
    ).toBe(true)
  })

  it('logs domain events', async () => {
    const context = createContext()
    const registry = new ModuleRegistry(context)
    const logger = new RuntimeLoggerModule()

    registry.register(logger)
    await registry.init(logger.id)
    await registry.activate(logger.id)

    context.events.emit({
      name: 'photo:added',
      category: 'domain',
      source: { moduleId: 'photo-feed', entity: 'photo' },
      payload: {
        photoId: '123',
        url: 'https://example.com',
        addedAt: Date.now(), // Corregido: Propiedad obligatoria añadida
      },
      timestamp: Date.now(),
    })

    expect(logSpy.mock.calls.some((call: unknown[]) => 
      String(call[0]).includes('[DOMAIN]')
    )).toBe(true)
  })

  it('logs error events using console.error', async () => {
    const context = createContext()
    const registry = new ModuleRegistry(context)
    const logger = new RuntimeLoggerModule()

    registry.register(logger)
    await registry.init(logger.id)
    await registry.activate(logger.id)

    context.events.emit({
      name: 'module:error',
      category: 'error',
      source: { moduleId: 'photo-feed' },
      payload: {
        moduleId: 'photo-feed', // <--- Propiedad faltante añadida
        action: 'initialize',
        error: new Error('Something went wrong'),
      },
      timestamp: Date.now(),
    })

    expect(errorSpy.mock.calls.some((call: unknown[]) => 
      String(call[0]).includes('[ERROR]')
    )).toBe(true)
  })

  it('ignores unknown event categories', async () => {
    const context = createContext()
    const registry = new ModuleRegistry(context)
    const logger = new RuntimeLoggerModule()

    registry.register(logger)
    await registry.init(logger.id)
    await registry.activate(logger.id)

    logSpy.mockClear()
    errorSpy.mockClear()

    context.events.emit({
      name: 'unknow:event' as any,
      category: 'custom' as any,
      payload: {}, // Corregido: Payload es obligatorio en la interfaz DomainEvent
      timestamp: Date.now()
    })

    expect(logSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })
})