import { CoreContext } from '../../context/CoreContext'
import { vi } from 'vitest'

export const createMockeCoreContext = (): CoreContext => ({
  events: {
    emit: vi.fn(),
    on: vi.fn()
  },
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  storage: {} as any,
  config: {
    enviroment: 'test',
    version: '0.0.0-test'
  },
  permission: {
    has: vi.fn(),
    request: vi.fn()
  }
})
