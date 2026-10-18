import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryStorageAdapter } from './InMemoryStorageAdapter.js'

describe('InMemoryStorageAdapter', () => {
  let storage: InMemoryStorageAdapter

  beforeEach(() => {
    storage = new InMemoryStorageAdapter('test_')
  })

  it('devuelve null cuando la clave no existe', async () => {
    expect(await storage.get('missing')).toBeNull()
  })

  it('persiste y recupera valores (set/get)', async () => {
    await storage.set('urls', ['a', 'b'])
    expect(await storage.get<string[]>('urls')).toEqual(['a', 'b'])
  })

  it('sobrescribe valores existentes', async () => {
    await storage.set('k', 1)
    await storage.set('k', 2)
    expect(await storage.get<number>('k')).toBe(2)
  })

  it('remove elimina la clave', async () => {
    await storage.set('k', 1)
    await storage.remove('k')
    expect(await storage.exists('k')).toBe(false)
    expect(await storage.get('k')).toBeNull()
  })

  it('exists refleja el estado de la clave', async () => {
    expect(await storage.exists('k')).toBe(false)
    await storage.set('k', true)
    expect(await storage.exists('k')).toBe(true)
  })

  it('aisla los namespaces mediante el prefijo', async () => {
    const other = new InMemoryStorageAdapter('other_')
    await storage.set('shared', 'mine')
    expect(await other.get('shared')).toBeNull()
    await other.set('shared', 'theirs')
    expect(await storage.get<string>('shared')).toBe('mine')
  })
})
