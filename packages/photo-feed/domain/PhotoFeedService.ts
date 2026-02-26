// modules/photo-feed/domain/PhotoFeedService.ts
import { nanoid } from 'nanoid'
import { EditPhotoInput } from './EditPhotoInput'
import { PhotoChanges } from './PhotoChanges'
import { Photo } from './Photo.js'

export class PhotoFeedService {
  private photos: Photo[] = []

  /* --- Commands --- */

  addPhoto(url: string): Photo {
    const photo = new Photo(nanoid(), url)

    this.photos.push(photo)
    return photo
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
