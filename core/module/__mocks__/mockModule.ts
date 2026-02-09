// core/module/__mocks__/mockModule.ts
import { AppModule } from '../AppModule'
import { ModuleState } from '../ModuleState'
import { CoreContext } from '../../context/CoreContext'

export const createMockModule = (id = 'test-module'): AppModule => ({
  id,
  version: '1.0.0',
  state: ModuleState.Registered,

  init: async (_context: CoreContext) => {},
  activate: async () => {},
  deactivate: async () => {},
  dispose: async () => {}
})
