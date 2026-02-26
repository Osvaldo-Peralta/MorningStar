// core/context/EventBus.ts
import { DomainEvent } from "./DomainEvent"

export type EventHandler<
  TEventMap,
  K extends keyof TEventMap
> = (event: DomainEvent<TEventMap[K]> & { name: K }) => void

// Definido un tipo para la limpieza
export type Unsubscribe = () => void;

export interface EventBus<
  TEventMap extends Record<string, unknown>
> {
  emit<K extends keyof TEventMap>(
    event: DomainEvent<TEventMap[K]> & { name: K }
  ): void

  // Ahora devuelve Unsubscribe en lugar de void
  on<K extends keyof TEventMap>(
    eventName: K,
    handler: EventHandler<TEventMap, K>
  ): Unsubscribe

  off<K extends keyof TEventMap>(
    eventName: K,
    handler: EventHandler<TEventMap, K>
  ): void

  on(
    eventName: '*',
    handler: (event: DomainEvent<any>) => void
  ): Unsubscribe
}