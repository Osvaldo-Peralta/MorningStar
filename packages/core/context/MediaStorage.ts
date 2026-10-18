// core/context/MediaStorage.ts

/**
 * Puerto de almacenamiento de archivos multimedia (ADR-0004).
 *
 * Separa dos responsabilidades que NO deben mezclarse:
 * - La **metadata** del recurso (MediaObject/MediaRef) la persiste el módulo
 *   de dominio vía el puerto `Persistence` (ADR-0003).
 * - Los **bytes** viven exclusivamente detrás de este puerto.
 *
 * El dominio trabaja con REFERENCIAS (MediaRef), nunca con binarios: así el
 * proveedor (memoria, IndexedDB, archivos, object storage) es sustituible
 * sin tocar los módulos.
 */

/** Metadata de un objeto multimedia ya almacenado. */
export interface MediaObject {
  readonly id: string        // identidad estable del binario
  readonly mimeType: string
  readonly size: number      // bytes
  readonly createdAt: number
}

/**
 * Referencia a un medio, apta para persistirse en un `PersistedRecord`.
 * No contiene bytes ni URIs (las URIs son efímeras y se re-resuelven).
 */
export interface MediaRef {
  readonly mediaId: string
  readonly mimeType: string
  readonly size: number
}

export interface MediaStorage {
  /**
   * Almacena bytes y devuelve su metadata. Debe hacer copia defensiva de
   * `data`. Lanza si `data` está vacío o falta `mimeType`.
   */
  put(data: Uint8Array, mimeType: string): Promise<MediaObject>

  /** Bytes almacenados, o `null` si el id no existe. */
  get(mediaId: string): Promise<Uint8Array | null>

  /**
   * URI consumible por el entorno actual (`data:`, `blob:`, `file:`, `http:`…)
   * o `null` si el id no existe. Las URIs pueden ser efímeras: los consumidores
   * NO deben persistirlas.
   */
  getUri(mediaId: string): Promise<string | null>

  /** Elimina el binario. Devuelve `false` si no existía. */
  remove(mediaId: string): Promise<boolean>
}

/** Proyección de `MediaObject` a la referencia que persiste el dominio. */
export function toMediaRef(object: MediaObject): MediaRef {
  return {
    mediaId: object.id,
    mimeType: object.mimeType,
    size: object.size,
  }
}

/**
 * Validación mínima del contrato `put`, compartida por todos los adaptadores.
 * Las políticas de negocio (tipos permitidos, tamaño máximo) pertenecen al
 * módulo de dominio (ej. photo-feed), no al puerto.
 */
export function assertValidMediaInput(data: Uint8Array, mimeType: string): void {
  if (!(data instanceof Uint8Array)) {
    throw new TypeError('MediaStorage.put: data must be a Uint8Array')
  }
  if (data.byteLength === 0) {
    throw new Error('MediaStorage.put: empty media data')
  }
  if (typeof mimeType !== 'string' || mimeType.length === 0) {
    throw new Error('MediaStorage.put: mimeType is required')
  }
}
