// core/context/CoreEventMap.ts
import { ModuleEvents } from "./events";
import { PhotoAddedPayload, PhotoEditedPayload } from "../../modules/photo-feed/events";

export interface CoreEventMap {
  // Lifecycle
  [ModuleEvents.REGISTERED]: { moduleId: string }
  [ModuleEvents.INITIALIZED]: { moduleId: string }
  [ModuleEvents.ACTIVATED]: { moduleId: string }
  [ModuleEvents.DEACTIVATED]: { moduleId: string }
  [ModuleEvents.DISPOSED]: { moduleId: string }
  [ModuleEvents.ERROR]: { moduleId: string; action: string; error: unknown }

  // Domain: PhotoFeed
  'photo:added': PhotoAddedPayload
  'photo:edited': PhotoEditedPayload

  // Index signature para extensibilidad
  readonly [key: string]: Record<string, unknown> | unknown;
}