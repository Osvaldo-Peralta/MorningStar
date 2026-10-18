import type {
  PersistedRecord,
  PersistenceProvider,
  Repository,
} from "../context/Persistence.js";

/**
 * Repositorio volátil sobre un `Map` compartido por namespace.
 * Usa `structuredClone` para garantizar copias defensivas en ambas
 * direcciones (save y get), igual que los adaptadores serializadores.
 */
class InMemoryRepository<T extends PersistedRecord> implements Repository<T> {
    private readonly store: Map<string, T>;

    constructor(store: Map<string, T>) {
        this.store = store;
    }

    async get(id: string): Promise<T | null> {
        const found = this.store.get(id);
        return found === undefined ? null : structuredClone(found);
    }

    async save(record: T): Promise<T> {
        const copy = structuredClone(record);
        this.store.set(copy.id, copy);
        return structuredClone(copy);
    }

    async remove(id: string): Promise<boolean> {
        return this.store.delete(id);
    }

    async list(): Promise<T[]> {
        return Array.from(this.store.values(), (record) => structuredClone(record));
    }
}

/**
 * Adaptador de persistencia en memoria RAM.
 *
 * Casos de uso: tests, bootstrap de Node y mocks. Los datos no sobreviven
 * al proceso. Implementa el puerto `PersistenceProvider` (ADR-0003).
 */
export class InMemoryPersistenceAdapter implements PersistenceProvider {
    private readonly namespaces = new Map<string, Map<string, PersistedRecord>>();

    repository<T extends PersistedRecord>(namespace: string): Repository<T> {
        let store = this.namespaces.get(namespace);
        if (!store) {
            store = new Map<string, PersistedRecord>();
            this.namespaces.set(namespace, store);
        }
        return new InMemoryRepository<T>(store as Map<string, T>);
    }
}
