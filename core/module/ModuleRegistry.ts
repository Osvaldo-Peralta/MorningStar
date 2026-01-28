import { AppModule } from './AppModule'
import { ModuleState } from './ModuleState'
import { CoreContext } from '../context/CoreContext'
import {
  ModuleAlreadyRegisteredError,
  ModuleNotFoundError,
  InvalidModuleStateError
} from './errors'

export class ModuleRegistry {
  private modules = new Map<string, AppModule>()
  constructor(private readonly context: CoreContext) {}

    register(module: AppModule): void {
        if (this.modules.has(module.id)) {
            throw new ModuleAlreadyRegisteredError(module.id)
        }

        module.state = ModuleState.Registered
        this.modules.set(module.id, module)
    }

    async init(moduleId: string): Promise<void> {
    const module = this.get(moduleId)

    if (module.state !== ModuleState.Registered) {
        throw new InvalidModuleStateError(moduleId, module.state)
    }

    await module.init(this.context)
    module.state = ModuleState.Initialized
    }

    async activate(moduleId: string): Promise<void> {
        const module = this.get(moduleId)

        if (
            module.state !== ModuleState.Initialized &&
            module.state !== ModuleState.Inactive
        ) {
            throw new InvalidModuleStateError(moduleId, module.state)
        }

        await module.activate()
        module.state = ModuleState.Active
    }

    async deactivate(moduleId: string): Promise<void> {
        const module = this.get(moduleId)

        if (module.state !== ModuleState.Active) {
            throw new InvalidModuleStateError(moduleId, module.state)
        }

        await module.deactivate()
        module.state = ModuleState.Inactive
    }

    async dispose(moduleId: string): Promise<void> {
        const module = this.get(moduleId)

        if (module.state === ModuleState.Disposed) {
            throw new InvalidModuleStateError(moduleId, module.state)
        }
        await module.dispose()
        module.state = ModuleState.Disposed
        this.modules.delete(moduleId)
    }

    get(moduleId: string): AppModule {
        const module = this.modules.get(moduleId)
        if (!module) {
            throw new ModuleNotFoundError(moduleId)
        }
        return module
    }
}
