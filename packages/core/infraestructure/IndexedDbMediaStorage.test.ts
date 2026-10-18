// Registra el polyfill de IndexedDB para el entorno 'node' de Vitest
import 'fake-indexeddb/auto'
import { defineMediaStorageContractTests } from '../testing/defineMediaStorageContractTests.js'
import { IndexedDbMediaStorage } from './IndexedDbMediaStorage.js'

defineMediaStorageContractTests('IndexedDbMediaStorage', {
  create: () => {
    // Base de datos única por test: aislamiento total sin limpieza explícita
    return new IndexedDbMediaStorage(`morningstar-media-test-${crypto.randomUUID()}`)
  },
  destroy: (storage) => {
    if (storage instanceof IndexedDbMediaStorage) storage.dispose()
  },
})
