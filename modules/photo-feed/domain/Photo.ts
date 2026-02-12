// modules/photo-feed/domain/Photo.ts
export interface EditPhotoInput {
  url?: string
}

export class Photo {
  readonly id: string
  private _url: string

  readonly createdAt: number
  private _updatedAt: number

  constructor(id: string, url: string) {
    const now = Date.now()

    this.id = id
    this._url = url
    this.createdAt = now
    this._updatedAt = now
  }

  get url(): string {
    return this._url
  }

  get updatedAt(): number {
    return this._updatedAt
  }

  edit(input: EditPhotoInput): Record<string, {before: unknown, after: unknown}> {
    const changes: Record<string, {before: unknown, after: unknown}> = {}

    if(input.url !== undefined && input.url !== this._url) {
      changes.url = {before: this._url, after: input.url}
      this._url = input.url
    }

    if (Object.keys(changes).length > 0) {
      this._updatedAt = Date.now()
    }

    return changes
  }
}

/*
export type Photo = {
  id: string
  url: string
  createdAt: number
}
*/