import { describe, it, expect, vi } from 'vitest'
import type { DomainEvent } from './DomainEvent.js'
import { InMemoryEventBus } from './InMemoryEventBus.js'

type TestEventMap = {
  'test:event': { value: number }
}

describe('DomainEvent envelope — versionado (ADR-0001)', () => {
  it('acepta version opcional y el bus lo entrega intacto', () => {
    const bus = new InMemoryEventBus<TestEventMap>()
    const handler = vi.fn()
    bus.on('test:event', handler)

    const event: DomainEvent<TestEventMap['test:event']> & { name: 'test:event' } = {
      name: 'test:event',
      category: 'domain',
      payload: { value: 42 },
      timestamp: Date.now(),
      version: 2,
    }
    bus.emit(event)

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0]).toMatchObject({ version: 2, payload: { value: 42 } })
  })

  it('un evento sin version explícita es válido (v1 implícita)', () => {
    const bus = new InMemoryEventBus<TestEventMap>()
    const handler = vi.fn()
    bus.on('test:event', handler)

    bus.emit({
      name: 'test:event',
      category: 'domain',
      payload: { value: 1 },
      timestamp: Date.now(),
    })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0][0].version).toBeUndefined()
  })

  it('el wildcard también recibe el campo version', () => {
    const bus = new InMemoryEventBus<TestEventMap>()
    const wildcard = vi.fn()
    bus.on('*', wildcard)

    bus.emit({
      name: 'test:event',
      category: 'domain',
      payload: { value: 7 },
      timestamp: Date.now(),
      version: 3,
    })

    expect(wildcard).toHaveBeenCalledTimes(1)
    expect(wildcard.mock.calls[0][0]).toMatchObject({ name: 'test:event', version: 3 })
  })
})
