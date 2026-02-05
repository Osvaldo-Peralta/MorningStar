import { EventBus } from '../../core/context/EventBus'
import { PHOTO_FEED_EVENTS, PhotoCreatedPayload } from './events'
import { Photo } from './types'

export class PhotoFeedService {
  private photos: Photo[] = []

  constructor(private readonly eventBus: EventBus) {}

  addPhoto(photoId: string): Photo {
    const photo: Photo = {
      id: photoId,
      createdAt: Date.now(),
    }

    this.photos.push(photo)

    const payload: PhotoCreatedPayload = {
      photoId: photo.id,
      createdAt: photo.createdAt,
    }

    this.eventBus.emit(PHOTO_FEED_EVENTS.PHOTO_CREATED, payload)

    return photo
  }

  listPhotos(): string[] {
    return this.photos.map(p => p.id)
  }

  clear() {
    this.photos = []
  }
}
