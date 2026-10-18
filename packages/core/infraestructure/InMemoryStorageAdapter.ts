import type { Storage } from "../context/Storage.js";

/**
 * Adaptador de almacenamiento volátil (en memoria RAM).
 *
 * Implementa el mismo puerto `Storage` que `LocalStorageAdapter`, siguiendo
 * el patrón de puertos y adaptadores: el dominio no conoce la tecnología.
 *
 * Casos de uso:
 * - Backend / Node (donde `localStorage` no existe).
 * - Tests y entornos efímeros.
 *
 * Notas:
 * - Los datos NO persisten entre reinicios del proceso.
 * - Almacena referencias (no serializa como LocalStorageAdapter); el
 *   consumidor no debe mutar los objetos guardados.
 */
export class InMemoryStorageAdapter implements Storage {
    private readonly store = new Map<string, unknown>();
    private readonly prefix: string;

    constructor(prefix: string = '_app') {
        this.prefix = prefix;
    }

    private getFullKey(key: string): string {
        return `${this.prefix}${key}`;
    }

    async get<T>(key: string): Promise<T | null> {
        const value = this.store.get(this.getFullKey(key));
        return value === undefined ? null : (value as T);
    }

    async set<T>(key: string, value: T): Promise<void> {
        this.store.set(this.getFullKey(key), value);
    }

    async remove(key: string): Promise<void> {
        this.store.delete(this.getFullKey(key));
    }

    async exists(key: string): Promise<boolean> {
        return this.store.has(this.getFullKey(key));
    }
}
