import type { EventBus } from "./EventBus"
import type { Storage } from "./Storage"
import type { Permissions } from "./Permission"
import type { Logger } from "./Logger"
import type { CoreConfig } from "./Config"

export interface CoreContext {
    readonly events: EventBus
    readonly storage: Storage
    readonly permission: Permissions
    readonly logger: Logger
    readonly config: CoreConfig
}

// readonly -> los modulos no reemplazan los servicios