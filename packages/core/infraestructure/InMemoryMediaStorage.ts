import {
  assertValidMediaInput,
  type MediaObject,
  type MediaStorage,
} from "../context/MediaStorage.js";

interface StoredMedia {
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly size: number;
  readonly createdAt: number;
}

/** Convierte bytes a base64 en chunks (seguro para archivos grandes). */
function toBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < data.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...data.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

/**
 * Adaptador de MediaStorage en memoria RAM.
 *
 * Casos de uso: tests, bootstrap de Node y mocks. `getUri` devuelve una
 * `data:` URL (autocontenida, funciona en cualquier entorno). Los binarios
 * no sobreviven al proceso.
 */
export class InMemoryMediaStorage implements MediaStorage {
    private readonly objects = new Map<string, StoredMedia>();

    async put(data: Uint8Array, mimeType: string): Promise<MediaObject> {
        assertValidMediaInput(data, mimeType);

        const id = crypto.randomUUID();
        const copy = new Uint8Array(data); // copia defensiva
        const createdAt = Date.now();
        this.objects.set(id, { data: copy, mimeType, size: copy.byteLength, createdAt });

        return { id, mimeType, size: copy.byteLength, createdAt };
    }

    async get(mediaId: string): Promise<Uint8Array | null> {
        const stored = this.objects.get(mediaId);
        return stored ? new Uint8Array(stored.data) : null;
    }

    async getUri(mediaId: string): Promise<string | null> {
        const stored = this.objects.get(mediaId);
        if (!stored) return null;
        return `data:${stored.mimeType};base64,${toBase64(stored.data)}`;
    }

    async remove(mediaId: string): Promise<boolean> {
        return this.objects.delete(mediaId);
    }
}
