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
  private readonly handler = (event: DomainEvent<any> & { name: string }): void => {
    try {
      const timestamp = new Date(event.timestamp).toISOString();
      const source = event.source?.moduleId ? `[${event.source.moduleId}]` : '';

      switch (event.category) {
        case 'lifecycle':
          // Ahora imprimimos el ID del módulo que viene en el payload
          console.log(`[${timestamp}] [LIFECYCLE] ${source} ${event.name}`);
          break

        case 'domain':
          // Podemos ser más específicos si el evento es de fotos
          const detail = event.payload?.photoId ? `(ID: ${event.payload.photoId})` : '';
          console.log(`[${timestamp}] [DOMAIN] ${source} ${event.name} ${detail}`);
          break

        case 'error':
          console.error(`[${timestamp}] [ERROR] ${source} ${event.name}`, event.payload);
          break
      }
    } catch {
      // Fail-safe
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