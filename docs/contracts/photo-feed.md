# Contrato — `@morningstar/photo-feed`

- Estabilidad: **Stable (MVP)**
- Versión del paquete: 0.0.1
- Dueño de prefijos de eventos: `photo:`
- Dependencias: `@morningstar/core` (única — ADR-0002), `nanoid`

Módulo de dominio que gestiona una colección de fotografías (agregar, editar,
eliminar) con persistencia de URLs y eventos de dominio. En Fase 2 evolucionará
a almacenamiento real de medios sin cambiar este contrato de módulo.

---

## 1. API pública — `PhotoFeedModule`

```ts
export class PhotoFeedModule implements AppModule {
  readonly id = 'photo-feed'
  readonly version: string
  state: ModuleState

  addPhoto(url: string): Promise<void>
  editPhoto(photoId: string, input: EditPhotoInput): Promise<void>
  removePhoto(photoId: string): Promise<void>
  listEntries(): Photo[]
}
```

| Método | Precondiciones | Comportamiento | Errores |
|---|---|---|---|
| `addPhoto(url)` | módulo inicializado; `url` no vacío y empieza con `http` | Crea el agregado, persiste y emite `photo:added` | `Error('Not Initialized')`, `Error('Invalid photo URL')` |
| `editPhoto(id, input)` | módulo inicializado; la foto existe | Aplica cambios; **si no hay cambios reales, no persiste ni emite evento**; si los hay, persiste y emite `photo:edited` | `Error('Not Initialized')`, `Error('Photo <id> not found')` |
| `removePhoto(id)` | módulo inicializado; la foto existe | Elimina, persiste y emite `photo:removed` | `Error('Not Initialized')`, `Error('Photo <id> not found')` |
| `listEntries()` | módulo inicializado | Copia del array de agregados (no permite mutar la colección interna) | `Error('PhotoFeedModule not Initialized')` |

**`init(context)` requiere `context.persistence`** (camino único, ADR-0003):
si falta, lanza `Error("PhotoFeedModule requiere 'context.persistence' ...")`
— que el `ModuleRegistry` traduce a `module:error` + `ModuleLifecycleError`.

Orden de operaciones en cada comando: dominio → persistencia → evento.

## 2. Dominio

### `Photo` (agregado)

```ts
export class Photo {
  readonly id: string
  get url(): string
  get createdAt(): number
  get updatedAt(): number
  edit(input: EditPhotoInput): PhotoChanges
  toRecord(): PhotoRecord
  static fromRecord(record: PhotoRecord): Photo
}
```

- Estado mutable con campos privados reales (`#url`, `#createdAt`,
  `#updatedAt`): no se filtra en `JSON.stringify` / `console.log` /
  `structuredClone`.
- `edit()` devuelve solo los cambios efectivamente aplicados; no actualiza
  `updatedAt` si no hubo cambios.
- `toRecord()`/`fromRecord()` son el mapeo dominio↔persistencia (ADR-0003):
  la identidad (id, createdAt, updatedAt) sobrevive entre sesiones.

### Tipos de soporte

```ts
export type EditPhotoInput = { url?: string }
export type FieldChange<T> = { before: T; after: T }
export type PhotoChanges = { url?: FieldChange<string> }

export interface PhotoRecord extends PersistedRecord {
  readonly url: string
  readonly createdAt: number
  readonly updatedAt: number
}
```

### `PhotoFeedService`

Colección en memoria de agregados (`addPhoto`, `editPhoto`, `removePhoto`,
`listPhotos(): string[]`, `listEntries(): Photo[]`,
`getPhotoById(id): Photo | undefined`). Interno al módulo en la práctica:
exportado para tests; el consumo recomendado es vía `PhotoFeedModule`.

## 3. Eventos emitidos (ADR-0001, prefijo `photo:`)

Todos con `category: 'domain'`, `source: { moduleId: 'photo-feed', entity: 'photo', entityId? }`, `version` ausente (v1).

| Evento | Cuándo | Payload |
|---|---|---|
| `photo:added` | tras agregar y persistir | `{ photoId: string, url: string, addedAt: number }` |
| `photo:edited` | tras un edit **con cambios reales** | `{ photoId: string, changes: PhotoChanges }` |
| `photo:removed` | tras eliminar y persistir | `{ photoId: string, removedAt: number }` |

El módulo registra estos eventos en `CoreEventMap` por *module augmentation*
(`PhotoEventMap.ts`, exportado desde el índice público).

## 4. Persistencia

Puerto `Persistence` del core (ADR-0003), camino único desde la Fase 1:

| Namespace | Record | Escritura |
|---|---|---|
| `photo-feed:photos` | `PhotoRecord` (`{ id, url, createdAt, updatedAt }`) | en cada comando exitoso; hidratación en `init` |

- **Identidad estable:** la hidratación reconstruye los agregados con
  `Photo.fromRecord`, preservando `id`, `createdAt` y `updatedAt` entre
  sesiones. Los `photoId` ya pueden referenciarse de forma durable (deuda
  anterior resuelta).
- **Migración legacy (una vez):** en `init`, si existe la clave
  `photo-feed:data` del esquema anterior (`string[]` de URLs en `Storage`) y
  el repositorio está vacío, se importa como records (los ids se regeneran por
  última vez) y se descarta la clave legacy.
- El módulo requiere `context.persistence`; `context.storage` solo se usa para
  la migración legacy.

## 5. Permisos y configuración

- No solicita permisos todavía; al llegar la carga de archivos reales (Fase 2)
  declarará el permiso correspondiente en este contrato.
- No lee claves de `CoreConfig`; respeta `config.environment` solo de forma
  pasiva (no cambia comportamiento).
