// core/context/CoreEventMap.ts
import { ModuleEvents } from "./events";

export interface CoreEventMap {
  [ModuleEvents.REGISTERED]: { moduleId: string }
  [ModuleEvents.INITIALIZED]: { moduleId: string }
  [ModuleEvents.ACTIVATED]: { moduleId: string }
  [ModuleEvents.DEACTIVATED]: { moduleId: string }
  [ModuleEvents.DISPOSED]: { moduleId: string }
  [ModuleEvents.ERROR]: {
    moduleId: string
    action: string
    error: unknown
  }
  // En lugar de [key: string]: any, usamos esto para permitir 
  // la indexación pero manteniendo la estructura de objeto.
  readonly [key: string]: Record<string, unknown> | unknown;
}