import { AppModule } from '../../core/module'
import { ModuleState } from '../../core/module/ModuleState'
import { CoreContext } from '../../core/context/CoreContext'
import { SystemEvent } from '../../core/context/SystemEventCategory'

type SystemEventHandler = (event: SystemEvent) => void

export class RuntimeLoggerModule implements AppModule {
  readonly id = 'runtime-logger'
  readonly version = '0.1.0'
  state = ModuleState.Registered

  private events?: CoreContext['events']
  private handler?: SystemEventHandler

  async init(context: CoreContext): Promise<void> {
    this.events = context.events

    this.handler = (event: SystemEvent) => {
      try {
        // Filtrado mínimo (módulo pasivo)
        if (event.category !== 'lifecycle' && event.category !== 'error' && event.category !== 'domain') {
          return
        }

        // Timestamp legible
        const time = new Date(event.timestamp).toISOString()

        // 3️⃣ Información básica
        const category = event.category.toUpperCase()
        const name = event.name

        const sourceParts: string[] = []
        if (event.source?.moduleId) {
          sourceParts.push(`module=${event.source.moduleId}`)
        }
        if ((event.source as any)?.entity) {
          sourceParts.push(`entity=${(event.source as any).entity}`)
        }

        const source = sourceParts.length
        ? ` ${sourceParts.join(' ')}`
        : ''

        // Payload seguro
        let payload = ''
        if (event.payload !== undefined) {
          try {
            payload = ` payload=${JSON.stringify(event.payload)}`
          } catch {
            payload = ' payload=[unserializable]'
          }
        }

        // Output
        const message = `[${time}] [${category}] ${name}${source}${payload}`

        if (event.category === 'error') {
          console.error(message)
        } else {
          console.log(message)
        }
      } catch {
        // el logger nunca rompe el sistema
      }
    }

    // 🔌 Suscripción global (observabilidad pura)
    ;(this.events as any).onSystem('*', this.handler)
  }

  async activate(): Promise<void> {
    // pasivo: no-op
  }

  async deactivate(): Promise<void> {
    // pasivo: no-op
  }

  async dispose(): Promise<void> {
    if (this.events && this.handler) {
      ;(this.events as any).offSystem('*', this.handler)
    }

    this.handler = undefined
    this.events = undefined
  }
}
