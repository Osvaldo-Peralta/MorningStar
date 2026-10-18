// modules/photo-feed/domain/PhotoRecord.ts
import type { PersistedRecord } from '@morningstar/core'

/**
 * Proyección serializable del agregado `Photo` para el puerto de Persistence
 * (ADR-0003). Namespace del repositorio: `photo-feed:photos`.
 *
 * El dominio (clase `Photo`) nunca se persiste directamente: el mapeo vive en
 * `Photo.toRecord()` / `Photo.fromRecord()`.
 */
export interface PhotoRecord extends PersistedRecord {
  readonly url: string
  readonly createdAt: number
  readonly updatedAt: number
}
