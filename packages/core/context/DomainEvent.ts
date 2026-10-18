// core/context/DomainEvent.ts
import type { EventCategory } from "./EventCategory.js"

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
}