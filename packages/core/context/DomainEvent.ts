// core/context/DomainEvent.ts
import type { EventCategory } from "./EventCategory.js"

/**
 * Envelope de todo evento del sistema (lifecycle, dominio y error).
 *
 * Versionado: el campo opcional `version` implementa la estrategia definida
 * en docs/adr/ADR-0001-versionado-de-eventos.md. Un evento sin `version`
 * (o con `version: 1`) se considera esquema v1. Solo los breaking changes
 * incrementan este número, y conviven con el evento anterior durante la
 * ventana de deprecación.
 */
export interface DomainEvent<TPayload = unknown> {
    readonly name: string
    readonly category: EventCategory
    readonly source?: {
        moduleId: string
        entity?: string
        entityId?: string
    }
    readonly payload: TPayload
    readonly timestamp: number
    /** Versión del esquema del evento (ADR-0001). Ausente = v1. */
    readonly version?: number
}
