// core/context/InMemoryEventBus.ts
import { EventBus, EventHandler, Unsubscribe } from "./EventBus"
import { DomainEvent } from "./DomainEvent"

export class InMemoryEventBus<
  TEventMap extends Record<string, unknown>
> implements EventBus<TEventMap> {

  private handlers = new Map<string, Set<Function>>()

  emit<K extends keyof TEventMap>(
    event: DomainEvent<TEventMap[K]> & { name: K }
  ): void {
    const specific = this.handlers.get(event.name as string)
    const wildcard = this.handlers.get('*')

    specific?.forEach(h => h(event))
    wildcard?.forEach(h => h(event))
  }

  // 1. Sobrecarga para eventos específicos
  on<K extends keyof TEventMap>(
    eventName: K,
    handler: EventHandler<TEventMap, K>
  ): Unsubscribe // <-- Cambiado de void a Unsubscribe

  // 2. Sobrecarga para el wildcard '*'
  on(
    eventName: '*',
    handler: (event: DomainEvent<any>) => void
  ): Unsubscribe // <-- Cambiado de void a Unsubscribe

  // 3. Implementación real de la función
  on(eventName: any, handler: any): Unsubscribe {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, new Set())
    }

    this.handlers.get(eventName)!.add(handler)

    // Devolvemos la función de limpieza (Clean Code: el objeto sabe cómo limpiarse a sí mismo)
    return () => this.off(eventName, handler)
  }

  off<K extends keyof TEventMap>(
    eventName: K,
    handler: EventHandler<TEventMap, K>
  ): void {
    this.handlers.get(eventName as string)?.delete(handler)
  }
}