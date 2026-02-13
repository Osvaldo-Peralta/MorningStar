import { AppModule } from '../../core/module'
import { ModuleState } from '../../core/module/ModuleState.js'
import { CoreContext } from '../../core/context/CoreContext'
import { DomainEvent } from '../../core/context/DomainEvent'
import { CoreEventMap } from '../../core/context/CoreEventMap'

export class RuntimeLoggerModule implements AppModule {
  readonly id = 'runtime-logger'
  readonly version = '0.2.0' // Actualizado a la versión de la app
  state = ModuleState.Registered

  private events?: CoreContext<CoreEventMap>['events']

  // Eliminamos 'any'. Usamos Record<string, unknown> para eventos de dominio desconocidos
  private readonly handler = (event: DomainEvent<unknown> & { name: string }): void => {
    try {
      if (!event || typeof event !== 'object') return
      
      const timestamp = new Date(event.timestamp).toISOString()

      switch (event.category) {
        case 'lifecycle':
          console.log(`[${timestamp}] [LIFECYCLE] ${event.name}`)
          break
        case 'domain':
          console.log(`[${timestamp}] [DOMAIN] ${event.name}`)
          break
        case 'error':
          console.error(`[${timestamp}] [ERROR] ${event.name}`)
          break
      }
    } catch {
      // El logger no debe interrumpir el flujo principal
    }
  }

  async init(context: CoreContext<CoreEventMap>): Promise<void> {
    this.events = context.events
    this.events.on('*', this.handler)
  }

  async dispose(): Promise<void> {
    this.events?.off('*', this.handler)
    this.events = undefined
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}