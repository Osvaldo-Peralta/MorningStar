import { AppModule } from '@morningstar/core'
import { ModuleState } from '@morningstar/core'
import { CoreContext } from '@morningstar/core'
import { DomainEvent } from '@morningstar/core'
import { CoreEventMap } from '@morningstar/core'

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
          console.log(`[${timestamp}] [LIFECYCLE] ${source} ${event.name}`);
          break;

        case 'domain': {
          let detail = event.payload?.photoId ? `(ID: ${event.payload.photoId})` : '';
          
          // Lógica específica para mostrar cambios si existen
          if (event.name === 'photo:edited' && event.payload?.changes) {
            const changes = event.payload.changes;
            const logChanges = Object.entries(changes)
              .map(([field, change]: [string, any]) => 
                `${field}: ${change.before} -> ${change.after}`
              ).join(', ');
            
            detail += ` | Changes: { ${logChanges} }`;
          }

          console.log(`[${timestamp}] [DOMAIN] ${source} ${event.name} ${detail}`);
          break;
        }

        case 'error':
          console.error(`[${timestamp}] [ERROR] ${source} ${event.name}`, event.payload);
          break;
      }
    } catch {
      // El logger nunca debe romper el hilo principal
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