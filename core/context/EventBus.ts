// core/context/EventBus.ts
import { DomainEvent } from "./DomainEvent"

export type EventHandler<
  TEventMap,
  K extends keyof TEventMap
> = (event: DomainEvent<TEventMap[K]> & { name: K }) => void

export interface EventBus<
  TEventMap extends Record<string, unknown>
> {
  emit<K extends keyof TEventMap>(
    event: DomainEvent<TEventMap[K]> & { name: K }
  ): void

  on<K extends keyof TEventMap>(
    eventName: K,
    handler: EventHandler<TEventMap, K>
  ): void

  off<K extends keyof TEventMap>(
    eventName: K,
    handler: EventHandler<TEventMap, K>
  ): void

  on(
    eventName: '*',
    handler: (event: DomainEvent<any>) => void
  ): void
}

// Implementaciones intercambiables (in-memory hoy, IPC mañana)
// EventBus es el contrato publico usado por: modulos, tests, bootstrap