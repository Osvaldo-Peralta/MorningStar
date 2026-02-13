// core/context/CoreContext.ts
import type { EventBus } from "./EventBus"
import type { Storage } from "./Storage"
import type { Permissions } from "./Permission"
import type { Logger } from "./Logger"
import type { CoreConfig } from "./Config"
import { CoreEventMap } from "./CoreEventMap"

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