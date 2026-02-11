// modules/photo-feed/domain/PhotoFeedService.ts
import { nanoid } from 'nanoid'
import { EditPhotoInput } from './EditPhotoInput'
import { PhotoChanges } from './PhotoChanges'
import { Photo } from './Photo'

export class PhotoFeedService {
  private photos: Photo[] = []

  /* --- Commands --- */

  addPhoto(url: string): Photo {
    const photo: Photo = {
      id: nanoid(),
      url,
      createdAt: Date.now(),
    }

    this.photos.push(photo)
    return photo
  }

  editPhoto(
    photoId: string,
    input: EditPhotoInput
  ): { updatedPhoto: Photo; changes: PhotoChanges } {
    const index = this.photos.findIndex(p => p.id === photoId)

    if (index === -1) {
      throw new Error(`Photo ${photoId} not found`)
    }

    const current = this.photos[index]
    const changes: PhotoChanges = {}

    if (input.url !== undefined && input.url !== current.url) {
      changes.url = {
        before: current.url,
        after: input.url,
      }
    }

    if (Object.keys(changes).length === 0) {
      return { updatedPhoto: current, changes }
    }

    const updated: Photo = {
      ...current,
      url: input.url ?? current.url,
    }

    this.photos[index] = updated

    return { updatedPhoto: updated, changes }
  }

  /* --- Queries --- */

  listPhotos(): string[] {
    return this.photos.map(photo => photo.url)
  }

  getPhotoById(photoId: string): Photo | undefined {
    return this.photos.find(photo => photo.id === photoId)
  }
}
