// modules/photo-feed/domain/Photo.ts
import type { EditPhotoInput } from './EditPhotoInput.js'
import type { PhotoChanges } from "./PhotoChanges.js"

/**
 * Agregado Photo (raíz de dominio del módulo photo-feed).
 *
 * El estado mutable usa campos privados reales de JavaScript (`#`), de modo
 * que la información interna no se filtra al serializar (JSON.stringify,
 * console.log, structuredClone). La lectura se expone mediante getters.
 */
export class Photo {
  readonly id: string
  #url: string

  readonly createdAt: number
  #updatedAt: number

  constructor(id: string, url: string) {
    const now = Date.now()

    this.id = id
    this.#url = url
    this.createdAt = now
    this.#updatedAt = now
  }

  get url(): string {
    return this.#url
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
}
