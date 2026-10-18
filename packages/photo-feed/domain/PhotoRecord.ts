// modules/photo-feed/domain/PhotoRecord.ts
import type { MediaRef, PersistedRecord } from '@morningstar/core'

/**
 * Proyección serializable del agregado `Photo` para el puerto de Persistence
 * (ADR-0003). Namespace del repositorio: `photo-feed:photos`.
 *
 * Fuentes posibles (mutuamente exclusivas):
 * - `url`: fotografía por enlace http(s) (flujo original).
 * - `media`: fotografía por archivo subido (ADR-0004). Solo se persiste la
 *   REFERENCIA al binario; los bytes viven en el puerto MediaStorage y la
 *   URI de visualización se re-resuelve en cada sesión.
 *
 * `url` pasó de requerido a opcional de forma aditiva: los records existentes
 * siguen siendo válidos.
 */
export interface PhotoRecord extends PersistedRecord {
  readonly url?: string
  readonly media?: MediaRef
  readonly createdAt: number
  readonly updatedAt: number
}
