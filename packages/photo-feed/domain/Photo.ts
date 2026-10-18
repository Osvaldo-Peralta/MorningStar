// modules/photo-feed/domain/Photo.ts
import type { EditPhotoInput } from './EditPhotoInput.js'
import type { PhotoChanges } from "./PhotoChanges.js"
import type { PhotoRecord } from "./PhotoRecord.js"

/**
 * Agregado Photo (raíz de dominio del módulo photo-feed).
 *
 * El estado mutable usa campos privados reales de JavaScript (`#`), de modo
 * que la información interna no se filtra al serializar (JSON.stringify,
 * console.log, structuredClone). La lectura se expone mediante getters.
 *
 * Persistencia: el agregado no se persiste directamente; `toRecord()` y
 * `fromRecord()` lo mapean a/desde `PhotoRecord` (ADR-0003), preservando la
 * identidad estable (id, createdAt, updatedAt) entre sesiones.
 */
export class Photo {
  readonly id: string
  #url: string
  #createdAt: number
  #updatedAt: number

  constructor(id: string, url: string) {
    const now = Date.now()

    this.id = id
    this.#url = url
    this.#createdAt = now
    this.#updatedAt = now
  }

  get url(): string {
    return this.#url
  }

  get createdAt(): number {
    return this.#createdAt
  }

  get updatedAt(): number {
    return this.#updatedAt
  }

  edit(input: EditPhotoInput): PhotoChanges {
    const changes: PhotoChanges = {}

    if(input.url !== undefined && input.url !== this.#url) {
      changes.url = {
        before: this.#url,
        after: input.url
      }
      this.#url = input.url
    }

    if (Object.keys(changes).length > 0) {
      this.#updatedAt = Date.now()
    }

    return changes
  }

  /** Proyección serializable para el repositorio (ADR-0003). */
  toRecord(): PhotoRecord {
    return {
      id: this.id,
      url: this.#url,
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
    }
  }

  /** Rehidrata el agregado desde un registro persistido, preservando identidad. */
  static fromRecord(record: PhotoRecord): Photo {
    const photo = new Photo(record.id, record.url)
    photo.#createdAt = record.createdAt
    photo.#updatedAt = record.updatedAt
    return photo
  }
}
