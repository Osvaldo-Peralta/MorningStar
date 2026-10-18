# Contrato — `@morningstar/core`

- Estabilidad: **Stable**
- Versión del paquete: 0.0.1
- Dueño de prefijos de eventos: `module:`
- Dependencias: ninguna (es la base del grafo — ADR-0002)

El core provee el sistema de módulos, el bus de eventos y los puertos de
infraestructura. **No conoce ningún módulo de funcionalidad.**

---

## 1. Sistema de módulos

### 1.1 `ModuleMetadata`

```ts
export interface ModuleMetadata {
  readonly id: string      // identificador único en el registro
  readonly version: string // semver del módulo
}
```

### 1.2 `ModuleState`

```ts
export const ModuleState = {
  Registered: 'registered',
  Initialized: 'initialized',
  Active: 'active',
  Inactive: 'inactive',
  Disposed: 'disposed',
} as const
export type ModuleState = (typeof ModuleState)[keyof typeof ModuleState]
```

Const object (no `enum`) por compatibilidad con `erasableSyntaxOnly` y type
stripping nativo de Node.

### 1.3 `ModuleLifecycle`

```ts
export interface ModuleLifecycle {
  state: ModuleState
  init(context: CoreContext<any>): void | Promise<void>
  activate(): void | Promise<void>
  deactivate(): void | Promise<void>
  dispose(): void | Promise<void>
}
```

Invariantes:
- `init` recibe el `CoreContext` **una sola vez**; el módulo puede retener
  referencias a sus capacidades hasta `dispose`.
- `dispose` debe liberar todos los recursos (suscripciones, timers, caches).
- Todos los métodos pueden ser sincrónicos o promesas.

### 1.4 `AppModule`

```ts
export interface AppModule extends ModuleMetadata, ModuleLifecycle {}
```

### 1.5 `ModuleRegistry`

```ts
export class ModuleRegistry {
  constructor(context: CoreContext<CoreEventMap>)
  register(module: AppModule): void
  get(moduleId: string): AppModule            // lanza ModuleNotFoundError
  init(moduleId: string): Promise<void>
  activate(moduleId: string): Promise<void>
  deactivate(moduleId: string): Promise<void>
  dispose(moduleId: string): Promise<void>
  list(): AppModule[]
}
```

**Tabla de transiciones de estado** (fuente de verdad: `ModuleRegistry.ts`):

| Operación | Estado requerido | Estado resultante | Error si no cumple |
|---|---|---|---|
| `register` | (nuevo módulo) | `Registered` | `ModuleAlreadyRegisteredError` (id duplicado) |
| `init` | `Registered` | `Initialized` | `InvalidModuleStateError` |
| `activate` | `Initialized` \| `Inactive` | `Active` | `InvalidModuleStateError` |
| `deactivate` | `Active` | `Inactive` | `InvalidModuleStateError` |
| `dispose` | `Initialized` \| `Inactive` | `Disposed` (se retira del registro) | `InvalidModuleStateError` |

Garantías:
- Si un método de lifecycle lanza, el registry emite `module:error` y
  re-lanza `ModuleLifecycleError` (el estado **no** avanza).
- Toda transición exitosa emite su evento de lifecycle (ver §2.2).
- Nota: `register` sobreescribe `module.state = Registered`; el patrón de
  `bootstrap` de llamar `logger.init(context)` antes de `register` es una
  excepción deliberada para que el logger capture los eventos de registro.

### 1.6 Errores (`errors.ts`)

```ts
ModuleError (base) extends Error
├── ModuleAlreadyRegisteredError  // register con id duplicado
├── ModuleNotFoundError           // get/transición sobre id inexistente
├── InvalidModuleStateError       // transición no permitida
└── ModuleLifecycleError          // el método del módulo lanzó
```

Todos conservan `name` estable (string) para filtros de log/audit.

---

## 2. Eventos

### 2.1 Envelope `DomainEvent`

```ts
export type EventCategory = 'domain' | 'lifecycle' | 'error'

export interface DomainEvent<TPayload = unknown> {
  readonly name: string
  readonly category: EventCategory
  readonly source?: { moduleId: string; entity?: string; entityId?: string }
  readonly payload: TPayload
  readonly timestamp: number
  readonly version?: number   // ausente = v1 (ADR-0001)
}
```

### 2.2 `ModuleEvents` (dueño: core)

```ts
export const ModuleEvents = {
  REGISTERED: 'module:registered',
  INITIALIZED: 'module:initialized',
  ACTIVATED: 'module:activated',
  DEACTIVATED: 'module:deactivated',
  DISPOSED: 'module:disposed',
  ERROR: 'module:error',
} as const
```

| Evento | Category | Payload |
|---|---|---|
| `module:registered` | lifecycle | `{ moduleId }` |
| `module:initialized` | lifecycle | `{ moduleId }` |
| `module:activated` | lifecycle | `{ moduleId }` |
| `module:deactivated` | lifecycle | `{ moduleId }` |
| `module:disposed` | lifecycle | `{ moduleId }` |
| `module:error` | error | `{ moduleId, action, error }` |

### 2.3 `CoreEventMap`

Mapa tipado de eventos. Contiene los de lifecycle y una index signature que
permite a los features extenderlo por *module augmentation* (ADR-0002 §3).

### 2.4 `EventBus` / `InMemoryEventBus`

```ts
export type Unsubscribe = () => void

export interface EventBus<TEventMap extends Record<string, unknown>> {
  emit<K extends keyof TEventMap>(event: DomainEvent<TEventMap[K]> & { name: K }): void
  on<K extends keyof TEventMap>(eventName: K, handler: EventHandler<TEventMap, K>): Unsubscribe
  off<K extends keyof TEventMap>(eventName: K, handler: EventHandler<TEventMap, K>): void
  on(eventName: '*', handler: (event: DomainEvent<any>) => void): Unsubscribe
}
```

Semántica de `InMemoryEventBus` (única implementación actual):
- Entrega **síncrona**, en el mismo microtask que `emit`.
- Sin reintentos ni persistencia: si no hay suscriptores, el evento se pierde
  (el Audit Trail de Fase 8 será el suscriptor durable).
- `'*'` recibe todos los eventos.
- `on()` devuelve `Unsubscribe`; llamarlo dos veces es inocuo.
- Un handler que lanza propaga la excepción al emisor (los handlers deben
  gestionar sus propios errores; ver runtime-logger para el patrón defensivo).

---

## 3. `CoreContext` — composición de capacidades

```ts
export interface CoreContext<
  TEventMap extends Record<string, unknown> = CoreEventMap
> {
  readonly events: EventBus<TEventMap>
  readonly storage: Storage
  readonly permission: Permissions
  readonly logger: Logger
  readonly config: CoreConfig
}
```

Miembros `readonly`: los módulos **no reemplazan** servicios del contexto.
El contexto lo construye la composición (bootstrap / AppProvider de la web) y
se inyecta en `init`.

### 3.1 Puerto `Storage`

```ts
export interface Storage {
  get<T>(key: string): Promise<T | null>   // null = no existe
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
  exists(key: string): Promise<boolean>
}
```

Reglas para implementadores:
- Los módulos almacenan bajo su **propio namespace** (ej. `photo-feed:data`);
  el adaptador puede añadir un prefijo global adicional.
- Fase 1 (roadmap) agregará el adaptador remoto; el puerto no cambia.

Adaptadores incluidos:

| Adaptador | Ámbito | Serialización | Notas |
|---|---|---|---|
| `LocalStorageAdapter(prefix)` | navegador | JSON (copia) | errores de I/O se registran y `get` devuelve `null` |
| `InMemoryStorageAdapter(prefix)` | Node/tests | ninguna (referencias) | volátil; no mutar valores guardados |

### 3.2 Puerto `Permissions`

```ts
export type Permission = 'filesystem' | 'network' | 'notifications' | 'camera' | 'microphone'

export interface Permissions {
  has(permission: Permission): boolean
  request(permission: Permission): Promise<boolean>
}
```

Estado actual: implementación stub (`true`) en bootstrap/web. La evaluación
real ALLOW/DENY/CONDITIONAL llegará con Authorization (Fase 5).

### 3.3 Puerto `Logger`

```ts
export interface Logger {
  debug(message: string, meta?: unknown): void
  info(message: string, meta?: unknown): void
  warn(message: string, meta?: unknown): void
  error(message: string, meta?: unknown): void
}
```

`console` satisface estructuralmente este puerto.

### 3.4 `CoreConfig`

```ts
export interface CoreConfig {
  environment: 'development' | 'test' | 'production'
  version: string
}
```

---

## Deuda conocida

- `Permission` cubre solo permisos de plataforma; el modelo de permisos de
  negocio/roles se define en Fase 5 (Authorization) y extenderá este puerto o
  agregará uno nuevo vía ADR.
- `InMemoryEventBus` es síncrono y sin backpressure; para mensajería (Fase 6)
  se evaluará un adaptador distribuido detrás del mismo puerto.
