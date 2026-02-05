// core/module/AppModule.ts
import { ModuleMetadata } from './ModuleMetadata'
import { ModuleLifecycle } from './ModuleLifecycle'

export interface AppModule extends ModuleMetadata, ModuleLifecycle {}
