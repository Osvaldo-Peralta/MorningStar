import { Storage } from "../context/Storage";

export class LocalStorageAdapter implements Storage {
    constructor(private readonly prefix: string = '_app') {}

    private getFullKey(key: string): string {
        return `${this.prefix}${key}`;
    }

    async get<T>(key: string): Promise<T | null> {
        try {
            const data = localStorage.getItem(this.getFullKey(key));
            return data ? (JSON.parse(data) as T) : null;
        } catch(error) {
            console.error(`Error reading key "${key}" from LocalStorage: `, error);
            return null;
        }
    }

    async set<T>(key: string, value: T): Promise<void> {
        try {
            const data = JSON.stringify(value);
            localStorage.setItem(this.getFullKey(key), data)
        } catch (error) {
            console.error(`Error writing key "${key}" to LocalStorage: `,error)
        }
    }

    async remove(key: string): Promise<void> {
        localStorage.removeItem(this.getFullKey(key));
    }

    async exists(key: string): Promise<boolean> {
        return localStorage.getItem(this.getFullKey(key)) !== null
    }
}