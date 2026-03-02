import { PhotoFeedModule } from "../PhotoFeedModule"
import { describe, it, expect, vitest } from "vitest"

describe('PhotoFeedModule - Edición de Fotos', () => {
    // Helper para crear un contexto con los mocks necesarios
    const createMockContext = () => {
        const emittedEvents: any[] = [];
        return {
            emittedEvents,
            context: {
                events: {
                    emit: (event: any) => emittedEvents.push(event),
                },
                // Mock del storage para evitar el error de 'undefined'
                storage: {
                    get: vitest.fn().mockResolvedValue([]),
                    set: vitest.fn().mockResolvedValue(undefined)
                }
            } as any
        };
    };

    it('does NOT emit photo:edited if edit does not change anything', async () => {
        const { context, emittedEvents } = createMockContext();
        const module = new PhotoFeedModule();
        await module.init(context);

        // Usamos URLs válidas con 'http'
        await module.addPhoto('http://photo-a.jpg');
        const photoId = emittedEvents[0].payload.photoId;

        await module.editPhoto(photoId, { url: 'http://photo-a.jpg' });

        expect(emittedEvents).toHaveLength(1);
        expect(emittedEvents[0].name).toBe('photo:added');
    });

    it('throws an error when trying to edit a non-existing photo', async () => {
        const { context } = createMockContext();
        const module = new PhotoFeedModule();
        await module.init(context);

        await expect(
            module.editPhoto('non-existent-id', { url: 'http://x.jpg' })
        ).rejects.toThrow('Photo non-existent-id not found');
    });

    it('emits events in the correct order: photo:added → photo:edited', async () => {
        const { context, emittedEvents } = createMockContext();
        const module = new PhotoFeedModule();
        await module.init(context);

        await module.addPhoto('http://photo-a.jpg');
        const photoId = emittedEvents[0].payload.photoId;

        await module.editPhoto(photoId, { url: 'http://photo-b.jpg' });

        expect(emittedEvents.map(e => e.name)).toEqual(['photo:added', 'photo:edited']);
    });
});