// core/context/Persistence.ts

/**
 * Puerto de persistencia de registros con identidad estable (ADR-0003).
 *
 * Regla arquitectónica: se persisten *records* (datos planos, serializables
 * en JSON), NUNCA agregados de dominio. Cada módulo posee su propio mapeo
 * agregado <-> record (ej. `Photo.toRecord()` / `Photo.fromRecord()`), de
 * modo que sustituir el adaptador (memoria, localStorage, archivos, SQL,
 * object storage) no obliga a tocar el dominio.
 *
 * `Storage` (clave-valor) sigue existiendo para configuración/flags; este
 * puerto es para entidades con identidad.
 */
export interface PersistedRecord {
  /** Identidad estable del registro, única dentro de su namespace. */
  readonly id: string
}

/**
 * Colección persistida de records bajo un namespace.
 *
 * Semántica garantizada por todo adaptador (ver contract-tests en
 * `@morningstar/core/testing`):
 * - `get` devuelve `null` cuando el id no existe.
 * - `save` es un upsert por `id`.
 * - `remove` devuelve `false` si el id no existía.
 * - `list` devuelve todos los records del namespace.
 * - Los adaptadores almacenan/entregan copias defensivas: mutar el objeto
 *   pasado a `save` o el resultado de `get` NO corrompe el almacén.
 */
export interface Repository<T extends PersistedRecord> {
  get(id: string): Promise<T | null>
  save(record: T): Promise<T>
  remove(id: string): Promise<boolean>
  list(): Promise<T[]>
}

/**
 * Punto de entrada del puerto. Los repositorios se obtienen por namespace
 * (`<modulo>:<recurso>`, ej. `photo-feed:photos`).
 *
 * Multiusuario: el provider se compone por *scope*. Hoy existe un provider
 * global; cuando llegue Identity (Fase 3), la composición creará providers
 * acotados por usuario/sesión SIN cambiar la forma de este puerto (ADR-0003).
 */
export interface PersistenceProvider {
  repository<T extends PersistedRecord>(namespace: string): Repository<T>
}
