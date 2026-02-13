// modules/photo-feed/__tests__/Photo.test.ts
import { describe, expect, it } from "vitest";
import { Photo } from "../domain/Photo";

it('should initialized createdAt and updatedAt with same value', () => {
    const photo = new Photo('1', 'url')

    expect(photo.updatedAt).toBe(photo.createdAt)
})

it('should update updatedAt when photo is edited', () => {
  const photo = new Photo('1', 'url')

  const before = photo.updatedAt

  photo.edit({ url: 'new-url' })

  expect(photo.updatedAt).toBeGreaterThanOrEqual(before)
})

it('should NOT update updatedAt when no changes are made', () => {
  const photo = new Photo('1', 'url')

  const before = photo.updatedAt

  photo.edit({ url: 'url' }) // mismo valor

  expect(photo.updatedAt).toBe(before)
})
