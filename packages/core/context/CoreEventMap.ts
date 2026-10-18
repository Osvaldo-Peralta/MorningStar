// core/context/CoreEventMap.ts
import { ModuleEvents } from "./events.js";

/**
 * Mapa de eventos públicos del Core.
 *
 * Contiene únicamente los eventos de lifecycle del sistema de módulos.
 * Los módulos de funcionalidad NO deben ser importados por el core;
 * en su lugar, extienden este contrato mediante *module augmentation*:
 *
 * ```ts
 * // dentro de un módulo (ej. @morningstar/photo-feed)
 * declare module '@morningstar/core' {
 *   interface CoreEventMap {
 *     'photo:added': PhotoAddedPayload
 *   }
 * }
 * ```
 *
 * Esto invierte la dependencia: el core define el puerto (contrato base)
 * y cada módulo aporta sus propios eventos sin acoplar al core.
 */
export interface CoreEventMap {
  // Lifecycle
  [ModuleEvents.REGISTERED]: { moduleId: string }
  [ModuleEvents.INITIALIZED]: { moduleId: string }
  [ModuleEvents.ACTIVATED]: { moduleId: string }
  [ModuleEvents.DEACTIVATED]: { moduleId: string }
  [ModuleEvents.DISPOSED]: { moduleId: string }
  [ModuleEvents.ERROR]: { moduleId: string; action: string; error: unknown }

  // Index signature para extensibilidad (augmentation de módulos)
  readonly [key: string]: Record<string, unknown> | unknown;
}
