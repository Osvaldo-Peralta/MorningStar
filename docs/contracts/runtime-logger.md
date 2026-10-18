# Contrato — `@morningstar/runtime-logger`

- Estabilidad: **Stable (MVP)**
- Versión del paquete: 0.0.1
- Dueño de prefijos de eventos: — (no emite eventos)
- Dependencias: `@morningstar/core` (única — ADR-0002)

Módulo **pasivo de observabilidad**: se suscribe a todos los eventos del bus
(`'*'`) y los formatea a consola. Es el consumidor de referencia del EventBus
y el primer componente de la observabilidad que pide la Fase 0 del roadmap.

---

## 1. API pública — `RuntimeLoggerModule`

```ts
export class RuntimeLoggerModule implements AppModule {
  readonly id = 'runtime-logger'
  readonly version: string
  state: ModuleState
  // init / activate / deactivate / dispose: contrato estándar de AppModule
}
```

- `init(context)`: se suscribe a `'*'` en `context.events`.
- `dispose()`: cancela la suscripción y libera referencias.
- `activate()` / `deactivate()`: no-op (reservados para feature-flags de
  nivel de log en el futuro).

**Patrón de montaje:** `bootstrap` llama `runtimeLogger.init(context)`
*antes* de `registry.register(...)`, de modo que el logger ya escucha cuando
el registry emite los primeros eventos de lifecycle (excepción documentada en
`core.md` §1.5).

## 2. Comportamiento por categoría

| `category` | Salida | Formato |
|---|---|---|
| `lifecycle` | `console.log` | `[ISO timestamp] [LIFECYCLE] [moduleId] nombre-evento` |
| `domain` | `console.log` | `[ISO timestamp] [DOMAIN] [moduleId] nombre-evento (ID: photoId)` + detalle de `changes` si el evento es `photo:edited` |
| `error` | `console.error` | `[ISO timestamp] [ERROR] [moduleId] nombre-evento` + payload |

## 3. Garantías

- **Nunca lanza**: el handler completo está envuelto en `try/catch` — un fallo
  de formateo no puede romper al emisor del evento ni a otros suscriptores.
- No muta los eventos ni el payload.
- No persiste nada (sin I/O más allá de consola).

## 4. Deuda conocida

- El formateo de `photo:edited` conoce el payload de photo-feed: acoplamiento
  con un módulo específico dentro de un logger genérico. Cuando llegue un
  segundo módulo de dominio, se refactorizará a **formateadores registrables**
  (mapa `prefijo → formatter`) — candidato natural junto al log estructurado
  de la Fase 0/acción #6 del roadmap.
- Salida humana (consola), no estructurada (JSON). El log estructurado se
  definirá antes del Audit Trail (Fase 8).
