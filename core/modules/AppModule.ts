import type { ModuleMetadata } from "./ModuleMetadata"
import type { ModuleLifecycle } from "./ModuleLifecycle"

export interface AppModule extends ModuleLifecycle {
    readonly metadata: ModuleMetadata
}