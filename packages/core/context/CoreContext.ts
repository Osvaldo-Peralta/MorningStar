// core/context/CoreContext.ts
import type { EventBus } from "./EventBus.js"
import type { Storage } from "./Storage.js"
import type { Permissions } from "./Permission.js"
import type { Logger } from "./Logger.js"
import type { CoreConfig } from "./Config.js"
import type { CoreEventMap } from "./CoreEventMap.js"
import type { PersistenceProvider } from "./Persistence.js"

// core/context/CoreContext.ts
export interface CoreContext<
  TEventMap extends Record<string, unknown> = CoreEventMap // Valor por defecto fuerte
> {
  readonly events: EventBus<TEventMap>
  readonly storage: Storage
  /**
   * Persistencia de records con identidad estable (ADR-0003).
   * Miembro opcional (cambio aditivo sobre contrato Stable): los módulos que
   * lo requieren — como photo-feed — lo declaran en su contrato y fallan en
   * `init` con un error explícito si falta.
   */
  readonly persistence?: PersistenceProvider
  readonly permission: Permissions
  readonly logger: Logger
  readonly config: CoreConfig
}

// readonly -> los modulos no reemplazan los servicios
