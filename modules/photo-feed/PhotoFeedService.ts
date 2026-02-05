export class PhotoFeedModule {
    private photos: string[] = []

    add(photoUrl: string): void {
        this.photos.push(photoUrl)
    }

    list(): string[] {
        return[...this.photos]
    }

    clear(): void {
        this.photos = []
    }
}