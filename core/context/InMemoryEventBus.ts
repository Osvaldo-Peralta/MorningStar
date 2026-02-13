import { EventBus, EventHandler } from "./EventBus"
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

  on<K extends keyof TEventMap>(
    eventName: K,
    handler: EventHandler<TEventMap, K>
  ): void

  on(
    eventName: '*',
    handler: (event: DomainEvent<any>) => void
  ): void

  on(eventName: any, handler: any): void {
    if (!this.handlers.has(eventName)) {
      this.handlers.set(eventName, new Set())
    }

    this.handlers.get(eventName)!.add(handler)
  }

  off<K extends keyof TEventMap>(
    eventName: K,
    handler: EventHandler<TEventMap, K>
  ): void {
    this.handlers.get(eventName as string)?.delete(handler)
  }
}