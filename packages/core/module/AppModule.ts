// core/module/AppModule.ts
import type { ModuleMetadata } from './ModuleMetadata.js'
import type { ModuleLifecycle } from './ModuleLifecycle.js'

export interface AppModule extends ModuleMetadata, ModuleLifecycle {}
