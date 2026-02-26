// core/module/ModuleRegistry.ts

import { AppModule } from './AppModule.js'
import { ModuleState } from './ModuleState.js'
import {
  ModuleAlreadyRegisteredError,
  ModuleNotFoundError,
  InvalidModuleStateError,
  ModuleLifecycleError
} from './errors.js'
import { CoreContext } from '../context/CoreContext.js'
import { ModuleEvents } from '../context/events.js'
import { DomainEvent } from '../context/DomainEvent.js'
import { CoreEventMap } from '../context/CoreEventMap.js'

export class ModuleRegistry {
  private readonly modules = new Map<string, AppModule>()

  constructor(
    private readonly context: CoreContext<CoreEventMap>
  ) {}

  private emitLifecycleEvent<K extends Extract<keyof CoreEventMap, string>>(
    name: K,
    moduleId: string
  ): void {
    // Al extraer solo los strings de las llaves, 'name' ya es asignable
    const event: DomainEvent<CoreEventMap[K]> & { name: K } = {
      name,
      category: 'lifecycle',
      source: { moduleId },
      // Usamos unknown como puente seguro para asignar el payload dinámico
      payload: { moduleId } as unknown as CoreEventMap[K],
      timestamp: Date.now(),
    };

    this.context.events.emit(event)
  }

  private emitErrorEvent(
    moduleId: string,
    action: string,
    error: unknown
  ): void {
    const event: DomainEvent<
      CoreEventMap[typeof ModuleEvents.ERROR]
    > & { name: typeof ModuleEvents.ERROR } = {
      name: ModuleEvents.ERROR,
      category: 'error',
      source: { moduleId },
      payload: { moduleId, action, error },
      timestamp: Date.now(),
    }

    this.context.events.emit(event)
  }

  register(module: AppModule): void {
    if (this.modules.has(module.id)) {
      throw new ModuleAlreadyRegisteredError(module.id)
    }

    module.state = ModuleState.Registered
    this.modules.set(module.id, module)

    this.emitLifecycleEvent(ModuleEvents.REGISTERED, module.id)
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
    this.emitLifecycleEvent(ModuleEvents.INITIALIZED, moduleId)
  } catch (error) {
    // Es vital que el error sea String(error) para asegurar compatibilidad
    this.emitErrorEvent(moduleId, 'init', error)
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
      this.emitLifecycleEvent(ModuleEvents.ACTIVATED, moduleId)
    } catch (error) {
      this.emitErrorEvent(moduleId, 'activate', error)
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
      this.emitLifecycleEvent(ModuleEvents.DEACTIVATED, moduleId)
    } catch (error) {
      this.emitErrorEvent(moduleId, 'deactivate', error)
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
      this.emitLifecycleEvent(ModuleEvents.DISPOSED, moduleId)
    } catch (error) {
      this.emitErrorEvent(moduleId, 'dispose', error)
      throw new ModuleLifecycleError(moduleId, 'dispose', String(error))
    }
  }

  list(): AppModule[] {
    return Array.from(this.modules.values())
  }
}
