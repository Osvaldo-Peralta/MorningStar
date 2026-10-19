// modules/photo-feed/events.ts
import type { MediaRef } from '@morningstar/core'
import type { PhotoChanges } from "./domain/PhotoChanges.js"

export const PHOTO_FEED_EVENTS = {
  PHOTO_ADDED: 'photo:added',
  PHOTO_EDITED: 'photo:edited',
  PHOTO_REMOVED: 'photo:removed',
} as const

export interface PhotoAddedPayload {
  readonly photoId: string
  /**
   * En fotos por archivo subido, esta URL es la URI de sesión (efímera).
   * Los consumidores durables deben preferir `media.mediaId` (ADR-0004).
   */
  readonly url: string
  readonly addedAt: number
  /** Campo aditivo v1 (ADR-0001): presente solo en fotos subidas como archivo. */
  readonly media?: MediaRef
  /** Campo aditivo v1 (ADR-0012): dueño de la foto; ausente en flujos legacy. */
  readonly ownerId?: string
}

export interface PhotoEditedPayload {
  readonly photoId: string
  readonly changes: PhotoChanges
}

export interface PhotoRemovedPayload {
  readonly photoId: string
  readonly removedAt: number
}