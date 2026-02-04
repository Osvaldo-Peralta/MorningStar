export type EventHandler<T = unknown> = (payload: T) => void

export interface EventBus {
    emit<T = unknown>(event: string, payload: T): void
    on<T = unknown>(event: string, handler: EventHandler<T>): void
    off<T = unknown>(event: string, handler: EventHandler<T>): void
}

// Implementaciones intercambiables (in-memory hoy, IPC mañana)