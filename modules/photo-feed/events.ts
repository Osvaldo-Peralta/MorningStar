// modules/photo-feed/events.ts
import { PhotoChanges } from "./domain/PhotoChanges"

export const PHOTO_FEED_EVENTS = {
  PHOTO_ADDED: 'photo:added',
  PHOTO_EDITED: 'photo:edited',
} as const

export interface PhotoAddedPayload {
  readonly photoId: string
  readonly url: string
  readonly addedAt: number
}

export interface PhotoEditedPayload {
  readonly photoId: string
  readonly changes: PhotoChanges
}