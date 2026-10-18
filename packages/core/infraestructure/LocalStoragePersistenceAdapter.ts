import type {
  PersistedRecord,
  PersistenceProvider,
  Repository,
} from "../context/Persistence.js";

/**
 * Repositorio respaldado por `localStorage`: un key por namespace con un
 * objeto JSON `{ [id]: record }`. Sigue la convención de `LocalStorageAdapter`
 * (errores de I/O se registran y las lecturas degradan a vacío).
 */
class LocalStorageRepository<T extends PersistedRecord> implements Repository<T> {
    private readonly key: string;

    constructor(key: string) {
        this.key = key;
    }

    private readAll(): Record<string, T> {
        try {
            const raw = localStorage.getItem(this.key);
            return raw ? (JSON.parse(raw) as Record<string, T>) : {};
        } catch (error) {
            console.error(`Error reading repository "${this.key}": `, error);
            return {};
        }
    }

    private writeAll(all: Record<string, T>): void {
        try {
            localStorage.setItem(this.key, JSON.stringify(all));
        } catch (error) {
            console.error(`Error writing repository "${this.key}": `, error);
        }
    }

    async get(id: string): Promise<T | null> {
        return this.readAll()[id] ?? null;
    }

    async save(record: T): Promise<T> {
        const all = this.readAll();
        all[record.id] = record;
        this.writeAll(all);
        return record;
    }

    async remove(id: string): Promise<boolean> {
        const all = this.readAll();
        if (!(id in all)) return false;
        delete all[id];
        this.writeAll(all);
        return true;
    }

    async list(): Promise<T[]> {
        return Object.values(this.readAll());
    }
}

/**
 * Adaptador de persistencia para desarrollo en navegador.
 *
 * Cada namespace vive bajo la clave `${prefix}repo:${namespace}`.
 * Es el equivalente durable-local de `InMemoryPersistenceAdapter`; la fuente
 * de verdad multiusuario llegará con el adaptador remoto (Fase 3+).
 */
export class LocalStoragePersistenceAdapter implements PersistenceProvider {
    private readonly prefix: string;

    constructor(prefix: string = '_app') {
        this.prefix = prefix;
    }

    repository<T extends PersistedRecord>(namespace: string): Repository<T> {
        return new LocalStorageRepository<T>(`${this.prefix}repo:${namespace}`);
    }
}
