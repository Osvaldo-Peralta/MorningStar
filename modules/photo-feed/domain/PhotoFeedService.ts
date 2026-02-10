// modules/photo-feed/PhotoFeedService.ts
import { nanoid } from 'nanoid'
import { EditPhotoInput } from './EditPhotoInput'
import { PhotoChanges } from './PhotoChanges'
import { Photo } from './Photo'

export class PhotoFeedService {
  private photos: Photo[] = []
/* --- Add Photo --- */
  addPhoto(url: string): Photo {
    const photo: Photo = {
      id: nanoid(),
      url,
      createdAt: Date.now()
    }
    this.photos.push(photo)
    return photo
  }

/* --- Edit Photo --- */
  editPhoto(photo: Photo, input: EditPhotoInput): {updatedPhoto: Photo, changes: PhotoChanges} {
    const changes: PhotoChanges = {}

    if (input.url !== undefined && input.url !== photo.url) {
      changes.url = {
        before: photo.url,
        after: input.url
      }
    }
    const updatedPhoto: Photo = input.url !== undefined
    ? {...photo, url: input.url}
    : photo

    return {updatedPhoto, changes}
  }

/* --- Queries --- */
  listPhotos(): string[] {
    // Backwuard-compatible
    return this.photos.map(photo => photo.url) 
  }

  getPhotoById(photoId: string): Photo | undefined {
    return this.photos.find(photo => photo.id === photoId)
  }
}