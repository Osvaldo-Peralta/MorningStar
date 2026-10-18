// modules/photo-feed/domain/PhotoFeedService.ts
import { nanoid } from 'nanoid'
import type { MediaRef } from '@morningstar/core'
import type { EditPhotoInput } from './EditPhotoInput.js'
import type { PhotoChanges } from './PhotoChanges.js'
import { Photo } from './Photo.js'

export class PhotoFeedService {
  private photos: Photo[] = []

  /* --- Commands --- */

  addPhoto(url: string): Photo {
    const photo = new Photo(nanoid(), url)

    this.photos.push(photo)
    return photo
  }

  /** Crea un agregado desde un archivo subido (ADR-0004): fuente media + URI de sesión. */
  addPhotoFromMedia(resolvedUri: string, media: MediaRef): Photo {
    const photo = new Photo(nanoid(), resolvedUri, media)

    this.photos.push(photo)
    return photo
  }

  /**
   * Rehidrata un agregado existente desde persistencia (ADR-0003).
   * A diferencia de `addPhoto`, NO genera identidad nueva: el agregado
   * conserva su id y timestamps originales.
   */
  restore(photo: Photo): void {
    this.photos.push(photo)
  }

  editPhoto(
    photoId: string,
    input: EditPhotoInput
  ): { updatedPhoto: Photo; changes: PhotoChanges } {
    const photo = this.photos.find(p => p.id === photoId)

    if (!photo) {
      throw new Error(`Photo ${photoId} not found`)
    }

    const changes = photo.edit(input)

    return {
      updatedPhoto: photo,
      changes,
    }
  }

  removePhoto(photoId: string): void {
    const originalLength = this.photos.length;
    
    // Enfoque funcional y limpio
    this.photos = this.photos.filter(photo => photo.id !== photoId);

    // Validación de que la operación ocurrió
    if (this.photos.length === originalLength) {
      throw new Error(`Photo ${photoId} not found`);
    }
  }

  /* --- Queries --- */

  listPhotos(): string[] {
    return this.photos.map(photo => photo.url)
  }

  listEntries(): Photo[] {
    return [...this.photos] // retornamos copia para evitar mutaciones directas
  }

  getPhotoById(photoId: string): Photo | undefined {
    return this.photos.find(photo => photo.id === photoId)
  }
}
