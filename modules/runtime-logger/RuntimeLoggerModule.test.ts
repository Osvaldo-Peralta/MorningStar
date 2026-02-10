import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RuntimeLoggerModule } from './RuntimeLoggerModule'
import { InMemoryEventBus } from '../../core/context/InMemoryEventBus'
import { CoreContext } from '../../core/context/CoreContext'
import { ModuleRegistry } from '../../core/module/ModuleRegistry'

describe('RuntimeLoggerModule', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let errorSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createContext() {
    return {
      events: new InMemoryEventBus(),
      storage: {} as any,
      permission: {} as any,
      logger: console,
      config: {
        environment: 'test',
        version: '0.0.0-test',
      },
    } satisfies CoreContext
  }

  it('logs lifecycle events', async () => {
    const context = createContext()
    const registry = new ModuleRegistry(context)
    const logger = new RuntimeLoggerModule()

    registry.register(logger)
    await registry.init(logger.id)
    await registry.activate(logger.id)

    expect(logSpy).toHaveBeenCalled()
    expect(
      logSpy.mock.calls.some(call =>
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
      source: {
        moduleId: 'photo-feed',
        entity: 'photo',
      },
      payload: {
        photoId: '123',
        url: 'https://example.com',
      },
      timestamp: Date.now(),
    })

    expect(logSpy).toHaveBeenCalled()
    expect(
      logSpy.mock.calls.some(call =>
        String(call[0]).includes('[DOMAIN]')
      )
    ).toBe(true)
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
      source: {
        moduleId: 'photo-feed',
      },
      payload: {
        message: 'Something went wrong',
      },
      timestamp: Date.now(),
    })

    expect(errorSpy).toHaveBeenCalled()
    expect(
      errorSpy.mock.calls.some(call =>
        String(call[0]).includes('[ERROR]')
      )
    ).toBe(true)
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
        name: 'unknow:event',
        category: 'custom' as any,
        timestamp: Date.now()
    })

    expect(logSpy).not.toHaveBeenCalled()
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('never throws when handling malformed events', async () => {
    const context = createContext()
    const registry = new ModuleRegistry(context)
    const logger = new RuntimeLoggerModule()

    registry.register(logger)
    await registry.init(logger.id)
    await registry.activate(logger.id)

    expect(() => {
      context.events.emit({
        name: 'bad:event',
        category: 'domain',
        payload: {
          circular: {} as any,
        },
        timestamp: Date.now(),
      })
    }).not.toThrow()
  })
})
