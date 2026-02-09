// core/module/__mocks__/mockCoreContext.ts
import { InMemoryEventBus } from '../../context/InMemoryEventBus'
import type { CoreContext } from '../../context/CoreContext'
import type { Permissions } from '../../context/Permission'
import type { Storage } from '../../context/Storage'
import type { Logger } from '../../context/Logger'

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
  permission: mockPermissions,
  logger: mockLogger,
  config: {
    environment: 'test',
    version: '0.0.0'
  }
})
