// core/module/__mocks__/mockCoreContext.ts
import { InMemoryEventBus } from '../../context/InMemoryEventBus.js'
import { InMemoryPersistenceAdapter } from '../../infraestructure/InMemoryPersistenceAdapter.js'
import type { CoreContext } from '../../context/CoreContext.js'
import type { Permissions } from '../../context/Permission.js'
import type { Storage } from '../../context/Storage.js'
import type { Logger } from '../../context/Logger.js'

const mockPermissions: Permissions = {
  has: () => true,
  request: async () => true
}

const mockStorage: Storage = {
  get: async () => null,
  set: async () => {},
  remove: async () => {},
  exists: async () => false
}

const mockLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {}
}

export const createMockCoreContext = (): CoreContext => ({
  events: new InMemoryEventBus(),
  storage: mockStorage,
  persistence: new InMemoryPersistenceAdapter(),
  permission: mockPermissions,
  logger: mockLogger,
  config: {
    environment: 'test',
    version: '0.0.0'
  }
})
