import { defineMediaStorageContractTests } from '../testing/defineMediaStorageContractTests.js'
import { InMemoryMediaStorage } from './InMemoryMediaStorage.js'

defineMediaStorageContractTests('InMemoryMediaStorage', {
  create: () => new InMemoryMediaStorage(),
})
