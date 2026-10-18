import { defineRepositoryContractTests } from '../testing/defineRepositoryContractTests.js'
import { InMemoryPersistenceAdapter } from './InMemoryPersistenceAdapter.js'

defineRepositoryContractTests('InMemoryPersistenceAdapter', {
  create: () => new InMemoryPersistenceAdapter(),
})
