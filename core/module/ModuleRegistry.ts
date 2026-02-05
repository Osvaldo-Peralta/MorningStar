// core/module/ModuleRegistry.ts
import { AppModule } from './AppModule'
import { ModuleState } from './ModuleState'
import {
  ModuleAlreadyRegisteredError,
  ModuleNotFoundError,
  InvalidModuleStateError,
  ModuleLifecycleError
} from './errors'
import { CoreContext } from '../context/CoreContext'
import { ModuleEvents } from '../context/events'

export class ModuleRegistry {
  private readonly modules = new Map<string, AppModule>()

  constructor(private readonly context: CoreContext) {}

  register(module: AppModule): void {
    if (this.modules.has(module.id)) {
      throw new ModuleAlreadyRegisteredError(module.id)
    }

    module.state = ModuleState.Registered
    this.modules.set(module.id, module)
    this.context.events.emit(ModuleEvents.REGISTERED, {
      moduleId: module.id
    })
  }

  get(moduleId: string): AppModule {
    const module = this.modules.get(moduleId)
    if (!module) {
      throw new ModuleNotFoundError(moduleId)
    }
    return module
  }

  async init(moduleId: string): Promise<void> {
    const module = this.get(moduleId)

    if (module.state !== ModuleState.Registered) {
      throw new InvalidModuleStateError(moduleId, module.state)
    }

    try {
      await module.init(this.context)
      module.state = ModuleState.Initialized
      this.context.events.emit(ModuleEvents.INITIALIZED, {
        moduleId
      })
    } catch (error) {
      // Eventualmente implementar este catch para el resto
        this.context.events.emit(ModuleEvents.ERROR, {
        moduleId,
        action: 'init',
        error
      })
      throw new ModuleLifecycleError(moduleId, 'init', String(error))
    }
  }

  async activate(moduleId: string): Promise<void> {
    const module = this.get(moduleId)

    if (
      module.state !== ModuleState.Initialized &&
      module.state !== ModuleState.Inactive
    ) {
      throw new InvalidModuleStateError(moduleId, module.state)
    }

    try {
      await module.activate()
      module.state = ModuleState.Active
      this.context.events.emit(ModuleEvents.ACTIVATED, {
        moduleId
      })
    } catch (error) {
      this.context.events.emit(ModuleEvents.ERROR, {
        moduleId,
        action: 'activate',
        error
      })
      throw new ModuleLifecycleError(moduleId, 'activate', String(error))
    }
  }

  async deactivate(moduleId: string): Promise<void> {
    const module = this.get(moduleId)

    if (module.state !== ModuleState.Active) {
      throw new InvalidModuleStateError(moduleId, module.state)
    }

    try {
      await module.deactivate()
      module.state = ModuleState.Inactive
      this.context.events.emit(ModuleEvents.DEACTIVATED, {
        moduleId
      })
    } catch (error) {
      this.context.events.emit(ModuleEvents.ERROR, {
        moduleId,
        action: 'deactivate',
        error
      })
      throw new ModuleLifecycleError(moduleId, 'deactivate', String(error))
    }
  }

  async dispose(moduleId: string): Promise<void> {
    const module = this.get(moduleId)

    if (
      module.state !== ModuleState.Initialized &&
      module.state !== ModuleState.Inactive
    ) {
      throw new InvalidModuleStateError(moduleId, module.state)
    }

    try {
      await module.dispose()
      module.state = ModuleState.Disposed
      this.modules.delete(moduleId)
      this.context.events.emit(ModuleEvents.DISPOSED, {
        moduleId
      })
    } catch (error) {
      this.context.events.emit(ModuleEvents.ERROR, {
        moduleId,
        action: 'dispose',
        error
      })
      throw new ModuleLifecycleError(moduleId, 'dispose', String(error))
    }
  }

  list(): AppModule[] {
    return Array.from(this.modules.values())
  }
}
