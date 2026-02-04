// core/module/__mocks__/mockModule.ts
import { AppModule, ModuleState } from '../index'
import { CoreContext } from '../../context/CoreContext'

export const createMockModule = (id = 'test-module'): AppModule => ({
  id,
  version: '1.0.0',
  state: ModuleState.Registered,

  init: (_ctx: CoreContext) => {},
  activate: () => {},
  deactivate: () => {},
  dispose: () => {}
})
