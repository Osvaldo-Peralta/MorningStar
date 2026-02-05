// core/context/InMemoryEventBus.ts
import { EventBus, EventHandler } from "./EventBus";

export class InMemoryEventBus implements EventBus {
    private listeners = new Map<string, Set<EventHandler>>()

    emit<T = unknown>(event: string, payload: T): void {
        const handlers = this.listeners.get(event)
        if(!handlers) return

        handlers.forEach(handler => handler(payload))
    }

    on<T = unknown>(event: string, handler: EventHandler<T>): void {
        if(!this.listeners.has(event)) {
            this.listeners.set(event, new Set())
        }
        this.listeners.get(event)!.add(handler as EventHandler)
    }

    off<T = unknown>(event: string, handler: EventHandler<T>): void {
        this.listeners.get(event)?.delete(handler as EventHandler)
    }
}