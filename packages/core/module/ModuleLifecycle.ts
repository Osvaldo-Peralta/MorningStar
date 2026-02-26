// core/module/ModuleLifecycle.ts
// Aquí definimos cuándo y cómo vive un módulo.
import { CoreContext } from '../context/CoreContext'
import { ModuleState } from './ModuleState'

// core/module/ModuleLifecycle.ts
export interface ModuleLifecycle {
  state: ModuleState
  // Cambiamos el parámetro para que acepte cualquier CoreContext 
  // que cumpla con la estructura básica de objetos.
  init(context: CoreContext<any>): void | Promise<void>
  activate(): void | Promise<void>
  deactivate(): void | Promise<void>
  dispose(): void | Promise<void>
}

/*
📌 Importante:

init siempre existe

activate / deactivate permiten feature flags

dispose libera recursos
*/