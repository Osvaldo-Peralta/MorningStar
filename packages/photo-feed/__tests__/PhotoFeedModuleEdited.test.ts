import { PhotoFeedModule } from "../PhotoFeedModule";
import { CoreContext } from '@morningstar/core'
import { describe, it, expect, vitest } from "vitest";

describe('PhotoFeedModule - photo:edited', () => {
    // Helper para crear un contexto con todos los servicios necesarios
    const createMockContext = () => {
        const emittedEvents: any[] = [];
        return {
            emittedEvents,
            context: {
                events: {
                    emit: (event: any) => emittedEvents.push(event),
                },
                // Añadimos el storage que faltaba
                storage: {
                    get: vitest.fn().mockResolvedValue([]),
                    set: vitest.fn().mockResolvedValue(undefined)
                }
            } as unknown as CoreContext
        };
    };

    it('emits photo:added and then photo:edited when a photo is edited', async () => {
        const { context, emittedEvents } = createMockContext();
        const module = new PhotoFeedModule();
        await module.init(context);

        // Acción 1: add photo (usando await y URL válida)
        await module.addPhoto('http://photo-a.jpg');
    
        expect(emittedEvents).toHaveLength(1);
        const photoId = emittedEvents[0].payload.photoId;

        // Acción 2: edit photo (usando await y URL válida)
        await module.editPhoto(photoId, { url: 'http://photo-b.jpg' });
        
        expect(emittedEvents).toHaveLength(2);
        const editedEvent = emittedEvents[1];

        expect(editedEvent.name).toBe('photo:edited');
        expect(editedEvent.payload.changes).toEqual({
            url: {
                before: 'http://photo-a.jpg',
                after: 'http://photo-b.jpg'
            },
        });
    });

    it('emits a photo:edited event for each consecutive valid edit', async () => {
        const { context, emittedEvents } = createMockContext();
        const module = new PhotoFeedModule();
        await module.init(context);

        await module.addPhoto('http://a.jpg');
        const photoId = emittedEvents[0].payload.photoId;
        emittedEvents.length = 0; // Limpiar para aislar

        await module.editPhoto(photoId, { url: 'http://b.jpg' });
        expect(emittedEvents[0].payload.changes.url).toEqual({ before: 'http://a.jpg', after: 'http://b.jpg' });

        emittedEvents.length = 0;

        await module.editPhoto(photoId, { url: 'http://c.jpg' });
        expect(emittedEvents[0].payload.changes.url).toEqual({ before: 'http://b.jpg', after: 'http://c.jpg' });
    });

    it('emits photo:edited with the exact expected contract shape', async () => {
        const { context, emittedEvents } = createMockContext();
        const module = new PhotoFeedModule();
        await module.init(context);

        await module.addPhoto('http://original.jpg');
        const photoId = emittedEvents[0].payload.photoId;

        await module.editPhoto(photoId, { url: 'http://updated.jpg' });
        const editedEvent = emittedEvents[1];

        expect(Object.keys(editedEvent)).toEqual(['name', 'category', 'source', 'payload', 'timestamp']);
        expect(editedEvent).toMatchObject({
            name: 'photo:edited',
            source: { moduleId: 'photo-feed', entity: 'photo', entityId: photoId }
        });
    });

    it('can be consumed by a listener without errors', async () => {
        const { context, emittedEvents } = createMockContext();
        const module = new PhotoFeedModule();
        await module.init(context);

        await module.addPhoto('http://x.jpg');
        const photoId = emittedEvents[0].payload.photoId;

        await module.editPhoto(photoId, { url: 'http://y.jpg' });

        expect(() => {
            const { before, after } = emittedEvents[1].payload.changes.url;
            return before && after;
        }).not.toThrow();
    });
});