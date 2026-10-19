# Contrato — `@morningstar/photo-feed`

- Estabilidad: **Stable (MVP)**
- Versión del paquete: 0.0.1 (módulo: 0.4.0)
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

  addPhoto(url: string, actor?: ActorContext): Promise<void>
  addPhotoFromFile(input: PhotoMediaInput, actor?: ActorContext): Promise<void>
  editPhoto(photoId: string, input: EditPhotoInput, actor?: ActorContext): Promise<void>
  removePhoto(photoId: string, actor?: ActorContext): Promise<void>
  listEntries(): Photo[]
}
```

**Enforcement de autorización (ADR-0012, Iteración 7b):** si la composición
inyecta `context.authorizer`, los comandos operan en modo **fail-closed**:

- Sin `actor` ⇒ `PermissionRequiredError` (no hay operaciones anónimas con
  autorización activa).
- Decisión DENY o CONDITIONAL ⇒ `PermissionDeniedError` **antes** de tocar
  dominio/infraestructura (cero efectos colaterales); CONDITIONAL expone
  `conditions` (el loop de cumplimiento es del backend).
- Permisos: `photo:create` (addPhoto/addPhotoFromFile), `photo:edit` y
  `photo:delete` con `resource: { type: 'photo', id, ownerId }` (el evaluador
  aplica `-own` / moderator / admin).
- Sin `authorizer` en el contexto: comportamiento local sin cambios (web
  actual, tests, dev).

| Método | Precondiciones | Comportamiento | Errores |
|---|---|---|---|
| `addPhoto(url, actor?)` | módulo inicializado; `url` no vacío y empieza con `http`; permiso `photo:create` | Crea el agregado (**stampea `ownerId = actor.userId`**), persiste y emite `photo:added` | `Error('Not Initialized')`, `Error('Invalid photo URL')`, `PermissionRequiredError`, `PermissionDeniedError` |
| `addPhotoFromFile(input, actor?)` | módulo inicializado; `context.media` presente; `input` supera `PHOTO_MEDIA_POLICY`; permiso `photo:create` | Valida (dominio) → enforcement → guarda binario (`MediaStorage`) → agregado + record → emite `photo:added` con `media` y `ownerId` | `Error('Not Initialized')`, error explícito si falta `context.media`, errores de validación (MIME/tamaño/vacío), `PermissionRequiredError`, `PermissionDeniedError` |
| `editPhoto(id, input, actor?)` | módulo inicializado; la foto existe; **la foto no es de media**; permiso `photo:edit` sobre el recurso | Enforcement → aplica cambios; **si no hay cambios reales, no persiste ni emite evento**; si los hay, persiste y emite `photo:edited` | `Error('Not Initialized')`, `Error('Photo <id> not found')`, `Error('Editing media photos is not supported yet')`, `PermissionRequiredError`, `PermissionDeniedError` |
| `removePhoto(id, actor?)` | módulo inicializado; la foto existe; permiso `photo:delete` sobre el recurso | Enforcement → elimina, persiste, limpia el binario asociado (best-effort) y emite `photo:removed` | `Error('Not Initialized')`, `Error('Photo <id> not found')`, `PermissionRequiredError`, `PermissionDeniedError` |
| `listEntries()` | módulo inicializado | Copia del array de agregados (no permite mutar la colección interna) | `Error('PhotoFeedModule not Initialized')` |

**`init(context)` requiere `context.persistence`** (camino único, ADR-0003):
si falta, lanza `Error("PhotoFeedModule requiere 'context.persistence' ...")`
— que el `ModuleRegistry` traduce a `module:error` + `ModuleLifecycleError`.
`context.media` es opcional: solo `addPhotoFromFile` lo requiere.

Orden de operaciones en cada comando: dominio → persistencia → evento
(en subidas: validación → binario → dominio → persistencia → evento).

**Política de validación de medios** (`PHOTO_MEDIA_POLICY`, ADR-0004):

| Regla | Valor |
|---|---|
| MIME permitidos | `image/jpeg`, `image/png`, `image/webp`, `image/gif` |
| Tamaño máximo | 10 MB |
| Data vacía | rechazada |

## 2. Dominio

### `Photo` (agregado)

```ts
export class Photo {
  readonly id: string
  get url(): string              // http(s) o URI de sesión resuelta (efímera); '' si el medio está huérfano
  get media(): MediaRef | undefined  // definido solo en fotos subidas como archivo
  get ownerId(): string | undefined  // dueño (userId); undefined en fotos legacy (ADR-0012)
  get createdAt(): number
  get updatedAt(): number
  edit(input: EditPhotoInput): PhotoChanges   // lanza en fotos con media (limitación ADR-0004)
  toRecord(): PhotoRecord
  static fromRecord(record: PhotoRecord, resolvedMediaUri?: string): Photo
}
```

- Estado mutable con campos privados reales (`#url`, `#media`, `#createdAt`,
  `#updatedAt`): no se filtra en `JSON.stringify` / `console.log` /
  `structuredClone`.
- `edit()` devuelve solo los cambios efectivamente aplicados; no actualiza
  `updatedAt` si no hubo cambios.
- `toRecord()`/`fromRecord()` son el mapeo dominio↔persistencia (ADR-0003):
  la identidad (id, createdAt, updatedAt) sobrevive entre sesiones. Las URIs
  de medios NO se persisten: se re-resuelven en cada `init` (ADR-0004).

### Tipos de soporte

```ts
export type EditPhotoInput = { url?: string }
export type FieldChange<T> = { before: T; after: T }
export type PhotoChanges = { url?: FieldChange<string> }

export interface PhotoRecord extends PersistedRecord {
  readonly url?: string        // fuente http(s)
  readonly media?: MediaRef    // fuente archivo (mutuamente exclusivos)
  readonly ownerId?: string    // dueño (aditivo 7b); ausente en fotos legacy
  readonly createdAt: number
  readonly updatedAt: number
}

export interface PhotoMediaInput { data: Uint8Array; mimeType: string }
export const PHOTO_MEDIA_POLICY  // { allowedMimeTypes, maxBytes }
export function validatePhotoMedia(input: PhotoMediaInput): void  // lanza Error descriptivo
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
| `photo:added` | tras agregar y persistir | `{ photoId: string, url: string, addedAt: number, media?: MediaRef, ownerId?: string }` — `media`/`ownerId` son campos aditivos v1 (ADR-0001/0012); con archivo subido, `url` es una URI de sesión efímera |
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
- **Medios (ADR-0004):** el record persiste solo la REFERENCIA
  (`media: MediaRef`); los bytes viven en el puerto `MediaStorage` y la URI
  de visualización se re-resuelve en cada `init`. `removePhoto` limpia el
  binario best-effort. **Media huérfana** (bytes perdidos): la foto se
  hidrata con `url === ''` y se conserva su metadata.
- **Migración legacy (una vez):** en `init`, si existe la clave
  `photo-feed:data` del esquema anterior (`string[]` de URLs en `Storage`) y
  el repositorio está vacío, se importa como records (los ids se regeneran por
  última vez) y se descarta la clave legacy.
- El módulo requiere `context.persistence`; `context.storage` solo se usa para
  la migración legacy y `context.media` solo para subidas de archivo.

## 5. Permisos y configuración

- No solicita permisos todavía; cuando la UI de subida (Iteración 3b) use
  cámara o archivos, se declarará aquí el permiso correspondiente.
- No lee claves de `CoreConfig`; respeta `config.environment` solo de forma
  pasiva (no cambia comportamiento).

## 6. Deuda conocida

- `editPhoto` no soporta fotos con media (error explícito); el reemplazo de
  binario llegará con la UI de re-upload.
- Sin GC de media huérfana (binarios cuyo record ya no existe); relevante
  cuando haya backend remoto (ADR-0004).
