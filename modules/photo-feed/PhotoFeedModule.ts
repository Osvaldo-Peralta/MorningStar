// modules/photo-feed/PhotoFeedModule.ts
import { AppModule, ModuleState } from "../../core/module";
import { CoreContext } from "../../core/context/CoreContext";

export class PhotoFeedModule implements AppModule {
    readonly id = 'photo-feed'
    readonly version: '0.1.0'
    state = ModuleState.Registered

    private context!: CoreContext
    private photos: string[] = []

    init(context: CoreContext): void | Promise<void> {
        this.context = context
        this.context.logger.info('[PhotoFeed] Initialized')

        // Ejemplo de como cargar un estado inicial desde 'storage'
        // por ahora será un dummy
        this.photos = []
    }

    activate(): void | Promise<void> {
        this.context.logger.info('[PhotoFeed] activated')
    }

    deactivate(): void | Promise<void> {
        this.context.logger.info('[PhotoFeed] deactivate')
    }

    dispose(): void | Promise<void> {
        this.context.logger.info('[PhotoFeed] dispose')
    }

    // --- API publica del modulo ---
    addPhoto(photoUrl: string): void {
        this.photos.push(photoUrl)
        this.context.logger.info('[PhotoFeed] photo added', photoUrl)
    }

    listPhotos(): string[] {
        return [...this.photos]
    }
}