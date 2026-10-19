// modules/photo-feed/domain/Photo.ts
import type { MediaRef } from '@morningstar/core'
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
 * Fuentes (ADR-0004): una foto nace de una URL http(s) o de un archivo subido
 * (`media`). En fotos con media, `url` expone la URI de visualización
 * resuelta en runtime (efímera, NO se persiste) — `''` si el binario quedó
 * huérfano.
 *
 * Persistencia: el agregado no se persiste directamente; `toRecord()` y
 * `fromRecord()` lo mapean a/desde `PhotoRecord` (ADR-0003), preservando la
 * identidad estable (id, createdAt, updatedAt) entre sesiones.
 */
export class Photo {
  readonly id: string
  #url: string
  #media?: MediaRef
  #ownerId?: string
  #createdAt: number
  #updatedAt: number

  constructor(id: string, url: string, media?: MediaRef, ownerId?: string) {
    const now = Date.now()

    this.id = id
    this.#url = url
    this.#media = media
    this.#ownerId = ownerId
    this.#createdAt = now
    this.#updatedAt = now
  }

  /** URI de visualización: http(s) en fotos por URL; URI resuelta (efímera) en fotos con media. */
  get url(): string {
    return this.#url
  }

  /** Referencia al binario (solo en fotos subidas como archivo). */
  get media(): MediaRef | undefined {
    return this.#media
  }

  /** Dueño de la foto (userId). Undefined en fotos legacy pre-ownership (ADR-0012). */
  get ownerId(): string | undefined {
    return this.#ownerId
  }

  get createdAt(): number {
    return this.#createdAt
  }

  get updatedAt(): number {
    return this.#updatedAt
  }

  edit(input: EditPhotoInput): PhotoChanges {
    if (this.#media) {
      // Editar la URI de una foto con media la sobrescribiría de forma no
      // durable (las URIs de medios son efímeras). El reemplazo completo del
      // binario se abordará en una iteración futura (ADR-0004).
      throw new Error('Editing media photos is not supported yet')
    }

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

  /** Proyección serializable para el repositorio (ADR-0003/0004/0012). */
  toRecord(): PhotoRecord {
    const base = {
      id: this.id,
      createdAt: this.#createdAt,
      updatedAt: this.#updatedAt,
    }
    const source = this.#media ? { media: this.#media } : { url: this.#url }
    const owner = this.#ownerId !== undefined ? { ownerId: this.#ownerId } : {}
    return { ...base, ...source, ...owner }
  }

  /**
   * Rehidrata el agregado desde un registro persistido, preservando identidad.
   * Para records con `media`, el módulo resuelve la URI vía MediaStorage y la
   * pasa como `resolvedMediaUri` (las URIs no se persisten).
   */
  static fromRecord(record: PhotoRecord, resolvedMediaUri = ''): Photo {
    const displayUrl = record.media ? resolvedMediaUri : (record.url ?? '')
    const photo = new Photo(record.id, displayUrl, record.media, record.ownerId)
    photo.#createdAt = record.createdAt
    photo.#updatedAt = record.updatedAt
    return photo
  }
}
