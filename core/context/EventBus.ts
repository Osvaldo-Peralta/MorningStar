export type EventHandler<T> = (payload: T) => void

export interface EventBus<EventMap = any> {
    emit<K extends keyof EventMap>(
        event: K,
        payload: EventMap[K]
    ): void

    on<K extends keyof EventMap> (
        event: K,
        handler: EventHandler<EventMap[K]>
    ): () => void
}