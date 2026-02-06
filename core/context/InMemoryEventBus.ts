import { EventBus, EventHandler } from "./EventBus"
import { SystemEvent, SystemEventCategory } from "./SystemEventCategory"

type PayloadHandler = EventHandler<unknown>
type SystemEventHandler = (event: SystemEvent) => void

export class InMemoryEventBus implements EventBus {
  /** Listeners legacy: reciben solo payload */
  private payloadListeners = new Map<string, Set<PayloadHandler>>()

  /** Listeners de sistema: reciben SystemEvent completo */
  private systemListeners = new Map<string | "*", Set<SystemEventHandler>>()

  emit<T = unknown>(event: string | SystemEvent<T>, payload?: T): void {
    const systemEvent = this.normalizeEvent(event, payload)

    // 1️⃣ Dispatch a listeners legacy (payload-only)
    const payloadHandlers = this.payloadListeners.get(systemEvent.name)
    if (payloadHandlers) {
      payloadHandlers.forEach(handler => {
        try {
          handler(systemEvent.payload)
        } catch {
          // Observabilidad no debe romper el flujo
        }
      })
    }

    // 2️⃣ Dispatch a system listeners específicos
    const systemHandlers = this.systemListeners.get(systemEvent.name)
    if (systemHandlers) {
      systemHandlers.forEach(handler => {
        try {
          handler(systemEvent)
        } catch {
          // Mismo criterio: no romper el bus
        }
      })
    }

    // 3️⃣ Dispatch a system listeners globales (*)
    const globalHandlers = this.systemListeners.get("*")
    if (globalHandlers) {
      globalHandlers.forEach(handler => {
        try {
          handler(systemEvent)
        } catch {
          // No-op
        }
      })
    }
  }

  on<T = unknown>(event: string, handler: EventHandler<T>): void {
    if (!this.payloadListeners.has(event)) {
      this.payloadListeners.set(event, new Set())
    }
    this.payloadListeners.get(event)!.add(handler as PayloadHandler)
  }

  off<T = unknown>(event: string, handler: EventHandler<T>): void {
    this.payloadListeners.get(event)?.delete(handler as PayloadHandler)
  }

  /* ======================================================
     🔒 MÉTODOS INTERNOS (no expuestos aún)
     ====================================================== */

  /** Registro de listeners de sistema (observabilidad) */
  onSystem(event: string | "*", handler: SystemEventHandler): void {
    if (!this.systemListeners.has(event)) {
      this.systemListeners.set(event, new Set())
    }
    this.systemListeners.get(event)!.add(handler)
  }

  offSystem(event: string | "*", handler: SystemEventHandler): void {
    this.systemListeners.get(event)?.delete(handler)
  }

  /** Normaliza cualquier entrada a SystemEvent */
  private normalizeEvent<T>(
    event: string | SystemEvent<T>,
    payload?: T
  ): SystemEvent<T> {
    if (typeof event === "string") {
      return {
        name: event,
        timestamp: Date.now(),
        category: this.inferCategory(event),
        payload
      }
    }

    return {
      ...event,
      timestamp: event.timestamp ?? Date.now()
    }
  }

  /** Inferencia determinística de categoría */
  private inferCategory(name: string): SystemEventCategory {
    if (name === "module:error") return "error"
    if (name.startsWith("module:")) return "lifecycle"
    return "domain"
  }
}