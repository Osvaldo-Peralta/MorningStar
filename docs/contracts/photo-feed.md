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

Orden de operaciones en cada comando: dominio → persistencia → evento.

## 2. Dominio

### `Photo` (agregado)

```ts
export class Photo {
  readonly id: string
  readonly createdAt: number
  get url(): string
  get updatedAt(): number
  edit(input: EditPhotoInput): PhotoChanges
}
```

- Estado mutable con campos privados reales (`#url`, `#updatedAt`): no se
  filtra en `JSON.stringify` / `console.log` / `structuredClone`.
- `edit()` devuelve solo los cambios efectivamente aplicados; no actualiza
  `updatedAt` si no hubo cambios.

### Tipos de soporte

```ts
export type EditPhotoInput = { url?: string }
export type FieldChange<T> = { before: T; after: T }
export type PhotoChanges = { url?: FieldChange<string> }
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

| Clave | Contenido | Escritura |
|---|---|---|
| `photo-feed:data` | `string[]` (URLs) | en cada comando exitoso; hidratación en `init` |

⚠️ **Limitación conocida (deuda de Fase 1/2):** la hidratación reconstruye los
agregados desde las URLs, por lo que **los `id` y timestamps cambian entre
sesiones**. Los consumidores no deben tratar `photoId` como estable entre
reinicio y persistencia remota. Esto se resuelve cuando el puerto de
persistencia multiusuario (Fase 1) y Media Storage (Fase 2) reemplacen el
esquema actual de "solo URLs".

## 5. Permisos y configuración

- No solicita permisos todavía; al llegar la carga de archivos reales (Fase 2)
  declarará el permiso correspondiente en este contrato.
- No lee claves de `CoreConfig`; respeta `config.environment` solo de forma
  pasiva (no cambia comportamiento).
