import { defineRepositoryContractTests } from '../testing/defineRepositoryContractTests.js'
import { LocalStoragePersistenceAdapter } from './LocalStoragePersistenceAdapter.js'

/**
 * Stub mínimo de la Web Storage API para ejecutar el adaptador en el
 * entorno 'node' de Vitest (el adaptador accede al global `localStorage`
 * de forma perezosa en cada operación).
 */
class LocalStorageStub {
  private map = new Map<string, string>()

  get length(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }

  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null
  }

  removeItem(key: string): void {
    this.map.delete(key)
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value))
  }
}

const stub = new LocalStorageStub()
;(globalThis as unknown as { localStorage: LocalStorageStub }).localStorage = stub

defineRepositoryContractTests('LocalStoragePersistenceAdapter', {
  create: () => {
    stub.clear()
    return new LocalStoragePersistenceAdapter('test_')
  },
})
