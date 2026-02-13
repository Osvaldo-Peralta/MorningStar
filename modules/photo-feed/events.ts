// modules/photo-feed/events.ts
import { PhotoChanges } from "./domain/PhotoChanges"

export const PHOTO_FEED_EVENTS = {
  PHOTO_CREATED: 'photo-feed.photo.created',
} as const

export interface PhotoCreatedPayload {
  photoId: string
  createdAt: number
}

export interface PhotoAddedPayload {
  photoId: string
  url: string
  addedAt: number
}

export interface PhotoEditedPayload {
  photoId: string
  changes: PhotoChanges
}