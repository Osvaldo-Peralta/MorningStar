// modules/photo-feed/events.ts
export const PHOTO_FEED_EVENTS = {
  PHOTO_CREATED: 'photo-feed.photo.created',
} as const

export interface PhotoCreatedPayload {
  photoId: string
  createdAt: number
}
