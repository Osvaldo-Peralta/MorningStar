// core/context/CoreContext.ts
import type { EventBus } from "./EventBus.js"
import type { Storage } from "./Storage.js"
import type { Permissions } from "./Permission.js"
import type { Logger } from "./Logger.js"
import type { CoreConfig } from "./Config.js"
import type { CoreEventMap } from "./CoreEventMap.js"

// core/context/CoreContext.ts
export interface CoreContext<
  TEventMap extends Record<string, unknown> = CoreEventMap // Valor por defecto fuerte
> {
  readonly events: EventBus<TEventMap>
  readonly storage: Storage
  readonly permission: Permissions
  readonly logger: Logger
  readonly config: CoreConfig
}

// readonly -> los modulos no reemplazan los servicios