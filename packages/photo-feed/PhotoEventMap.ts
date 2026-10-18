// modules/photo-feed/PhotoEventMap.ts
import type {
  PhotoAddedPayload,
  PhotoEditedPayload,
  PhotoRemovedPayload,
} from "./events.js";

/**
 * Mapa de eventos del módulo PhotoFeed.
 * Se expone como contrato público del módulo.
 */
export interface PhotoEventMap {
    'photo:added': PhotoAddedPayload;
    'photo:edited': PhotoEditedPayload;
    'photo:removed': PhotoRemovedPayload;
}

/**
 * Module augmentation: el módulo aporta sus eventos al contrato del Core.
 *
 * De esta forma `@morningstar/core` NO depende de `@morningstar/photo-feed`
 * (la dependencia va solo en una dirección: photo-feed -> core), y cualquier
 * consumidor que importe este paquete verá los eventos de foto tipados
 * dentro de `CoreEventMap`.
 */
declare module '@morningstar/core' {
  interface CoreEventMap {
    'photo:added': PhotoAddedPayload;
    'photo:edited': PhotoEditedPayload;
    'photo:removed': PhotoRemovedPayload;
  }
}
