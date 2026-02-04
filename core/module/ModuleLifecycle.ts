// Aquí definimos cuándo y cómo vive un módulo.
import { CoreContext } from '../context/CoreContext'
import { ModuleState } from './ModuleState'

export interface ModuleLifecycle {
  state: ModuleState

  init(context: CoreContext): void | Promise<void>
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