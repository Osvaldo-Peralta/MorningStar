// modules/photo-feed/PhotoFeedService.ts
import { nanoid } from 'nanoid'
type Photo = {
  id: string
  url: string
  createdAt: number
}

export class PhotoFeedService {
  private photos: Photo[] = []

  addPhoto(url: string): Photo {
    const photo: Photo = {
      id: nanoid(),
      url,
      createdAt: Date.now()
    }
    this.photos.push(photo)
    return photo
  }

  listPhotos(): string[] {
    // Backwuard-compatible
    return this.photos.map(photo => photo.url) 
  }

  getPhotoById(photoId: string): Photo | undefined {
    return this.photos.find(photo => photo.id === photoId)
  }
}