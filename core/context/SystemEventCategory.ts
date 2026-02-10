export type SystemEventCategory = 
| 'lifecycle'
| 'domain'
| 'error'

export type SystemEventSource = {
    moduleId: string
    [key: string]: unknown
}

export interface SystemEvent<T = unknown> {
    // Nombre semantico del evento
    name: string

    // timestamp generado por el sistema
    timestamp: number

    // Clasificación del evento
    category: SystemEventCategory

    // Origin logico del evento
    source?: SystemEventSource

    // Datos del dominio (indistinguible para core)
    payload?: T
}