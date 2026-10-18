import {
  assertValidMediaInput,
  type MediaObject,
  type MediaStorage,
} from "../context/MediaStorage.js";

const DEFAULT_DB_NAME = 'morningstar-media';
const STORE_NAME = 'objects';
const DB_VERSION = 1;

interface StoredEntry {
  readonly data: Uint8Array;
  readonly mimeType: string;
  readonly size: number;
  readonly createdAt: number;
}

/**
 * Adaptador de MediaStorage durable para navegador, sobre IndexedDB
 * (el estándar moderno para binarios en la web; localStorage no aplica).
 *
 * `getUri` devuelve `blob:` URLs cacheadas por sesión. Llamar a `dispose()`
 * al desmontar la aplicación para revocarlas.
 */
export class IndexedDbMediaStorage implements MediaStorage {
  private readonly dbName: string;
  private dbPromise?: Promise<IDBDatabase>;
  private readonly objectUrls = new Map<string, string>();

  constructor(dbName: string = DEFAULT_DB_NAME) {
    this.dbName = dbName;
  }

  private openDb(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.dbName, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.dbPromise;
  }

  private async run<T>(
    mode: IDBTransactionMode,
    action: (store: IDBObjectStore) => IDBRequest<T>
  ): Promise<T> {
    const db = await this.openDb();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async put(data: Uint8Array, mimeType: string): Promise<MediaObject> {
    assertValidMediaInput(data, mimeType);

    const id = crypto.randomUUID();
    const copy = new Uint8Array(data); // copia defensiva
    const createdAt = Date.now();
    const entry: StoredEntry = { data: copy, mimeType, size: copy.byteLength, createdAt };

    await this.run('readwrite', (store) => store.put(entry, id));

    return { id, mimeType, size: entry.size, createdAt };
  }

  async get(mediaId: string): Promise<Uint8Array | null> {
    const entry = await this.run<StoredEntry | undefined>('readonly', (store) => store.get(mediaId));
    return entry ? entry.data : null;
  }

  async getUri(mediaId: string): Promise<string | null> {
    const cached = this.objectUrls.get(mediaId);
    if (cached) return cached;

    const entry = await this.run<StoredEntry | undefined>('readonly', (store) => store.get(mediaId));
    if (!entry) return null;

    // Copia a un Uint8Array<ArrayBuffer> propio: compatible con BlobPart y
    // evita compartir el buffer almacenado
    const url = URL.createObjectURL(new Blob([new Uint8Array(entry.data)], { type: entry.mimeType }));
    this.objectUrls.set(mediaId, url);
    return url;
  }

  async remove(mediaId: string): Promise<boolean> {
    const existed = (await this.get(mediaId)) !== null;
    await this.run('readwrite', (store) => store.delete(mediaId));

    const url = this.objectUrls.get(mediaId);
    if (url) {
      URL.revokeObjectURL(url);
      this.objectUrls.delete(mediaId);
    }
    return existed;
  }

  /** Revoca todas las blob URLs cacheadas (llamar al disponer la aplicación). */
  dispose(): void {
    for (const url of this.objectUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.objectUrls.clear();
  }
}
