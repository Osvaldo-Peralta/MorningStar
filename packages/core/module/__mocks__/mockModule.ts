// core/module/__mocks__/mockModule.ts
import type { AppModule } from '../AppModule.js'
import { ModuleState } from '../ModuleState.js'
import type { CoreContext } from '../../context/CoreContext.js'

export const createMockModule = (id = 'test-module'): AppModule => ({
  id,
  version: '1.0.0',
  state: ModuleState.Registered,

  init: async (_context: CoreContext) => {},
  activate: async () => {},
  deactivate: async () => {},
  dispose: async () => {}
})
