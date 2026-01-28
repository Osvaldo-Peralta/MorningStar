// Aquí definimos cuándo y cómo vive un módulo.
import type { CoreContext } from "../context/CoreContext"

export interface ModuleLifecycle {
    // Se ejecuta una sola vez al cargar el moduli
    init(context: CoreContext): void | Promise<void>

    // Se ejecuta cuando el modulo se activa
    activate?(): void | Promise<void>

    // Se ejecuta cuando el modulo se desactiva
    deactivate?(): void | Promise<void>

    // Limpieza final
    dispose?(): void | Promise<void>
}

/*
📌 Importante:

init siempre existe

activate / deactivate permiten feature flags

dispose libera recursos
*/