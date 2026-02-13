import { AppModule } from '../../core/module'
import { ModuleState } from '../../core/module/ModuleState.js'
import { CoreContext } from '../../core/context/CoreContext'
import { DomainEvent } from '../../core/context/DomainEvent'

export class RuntimeLoggerModule implements AppModule {
  readonly id = 'runtime-logger'
  readonly version = '0.1.0'
  state = ModuleState.Registered

  private events?: CoreContext['events']

  // 🔒 Handler estable (no se reasigna)
  private readonly handler = (event: DomainEvent<any>): void => {
    try {
      if (!event || typeof event !== 'object') return
      if (!event.category || !event.name || !event.timestamp) return

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

        default:
          // 👇 esto hace que pase el test de unknown categories
          return
      }
    } catch {
      // 🔒 El logger nunca debe romper el sistema
    }
  }

  async init(context: CoreContext): Promise<void> {
    this.events = context.events
    this.events.on('*', this.handler)
  }

  async dispose(): Promise<void> {
    if (this.events) {
      this.events.off('*', this.handler)
    }

    this.events = undefined
  }

  async activate(): Promise<void> {}
  async deactivate(): Promise<void> {}
}
