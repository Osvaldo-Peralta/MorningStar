# ADR-0004 — Media Storage: metadata y binarios separados

- Status: **Accepted**
- Date: Octubre 2026
- Deciders: Osvaldo Peralta (+ asistencia de IA)
- Relacionados: ADR-0003 (Persistence), roadmap Fase 2, `docs/contracts/core.md` §3.6, `docs/contracts/photo-feed.md`

## Contexto

Hasta la Fase 2, PhotoFeed solo trabajaba con URLs http: no existía un lugar
al cual enviar un archivo real. El roadmap (§5) exige separar dos
responsabilidades: **metadata de la fotografía** y **almacenamiento del
archivo multimedia**, manteniendo el módulo desacoplado del proveedor.

Restricciones:
- El dominio no puede depender de APIs de plataforma (`File`, `Blob`, fs).
- Las URIs de visualización (`blob:`, `data:`) son efímeras: no pueden
  persistirse como fuente de verdad.
- La web necesita almacenamiento durable de binarios (localStorage no sirve
  para bytes); Node necesita un adaptador de desarrollo durable.

## Decisión

### 1. Nuevo puerto `MediaStorage` (en `@morningstar/core`)

```ts
interface MediaObject { id; mimeType; size; createdAt }
interface MediaRef    { mediaId; mimeType; size }   // lo único que persiste el dominio

interface MediaStorage {
  put(data: Uint8Array, mimeType: string): Promise<MediaObject>
  get(mediaId: string): Promise<Uint8Array | null>
  getUri(mediaId: string): Promise<string | null>
  remove(mediaId: string): Promise<boolean>
}
```

- **Bytes como `Uint8Array`**: representación neutral navegador/Node
  (`File.arrayBuffer()` en web, `fs.readFile` en Node).
- `CoreContext.media?: MediaStorage` — miembro opcional (aditivo); solo los
  flujos de subida lo requieren.
- `assertValidMediaInput` (integridad básica: no vacío, mime presente) es
  compartido por todos los adaptadores. **La validación de negocio** (tipos
  permitidos, tamaño máximo) pertenece al dominio del módulo, no al puerto.

### 2. El dominio persiste referencias, nunca bytes ni URIs

`PhotoRecord.media?: MediaRef` (cambio aditivo sobre ADR-0003). La URI de
visualización se **re-resuelve en cada sesión** vía `getUri(mediaId)`. Los
consumidores de eventos que necesiten durabilidad usan `media.mediaId`, no
`payload.url` (efímera en subidas).

### 3. Políticas de photo-feed (v1)

| Regla | Valor |
|---|---|
| MIME permitidos | `image/jpeg`, `image/png`, `image/webp`, `image/gif` |
| Tamaño máximo | 10 MB |
| Validación | `validatePhotoMedia` en el dominio, antes de tocar infraestructura |
| Edit de foto con media | No soportado todavía (error explícito); el reemplazo completo de binario llegará con la UI de re-upload |

Constantes en `PHOTO_MEDIA_POLICY`; hacerlas configurables por instancia es
un cambio aditivo futuro.

### 4. Matriz de adaptadores

| Adaptador | Paquete | `getUri` | Ámbito |
|---|---|---|---|
| `InMemoryMediaStorage` | core | `data:` URL | tests, bootstrap |
| `IndexedDbMediaStorage` | core | `blob:` URL (cacheada; `dispose()` la revoca) | **web producción/dev** — IndexedDB es el estándar moderno para binarios en navegador |
| `FileMediaStorage` (`.bin` + sidecar `.json`) | `@morningstar/persistence-node` | `file://` | desarrollo Node |
| Remoto (object storage / CDN) | por decidir | `http(s)` | backend multiusuario (Fase 3+) |

Todos pasan los contract-tests compartidos
(`defineMediaStorageContractTests` en `@morningstar/core/testing`). Para
testear IndexedDB en CI (entorno node) se usa `fake-indexeddb` (devDependency).

### 5. Ciclo de vida y limpieza

- `removePhoto` limpia el binario **best-effort**: el borrado de metadata no
  falla si el binario no puede eliminarse.
- **Media huérfana** (metadata sin bytes): la foto se hidrata con URI vacía y
  la UI muestra placeholder. Un GC de huérfanos queda registrado como deuda
  (relevante cuando exista backend).

### 6. Por qué no un solo puerto "Storage de archivos" junto a Persistence

Son ejes distintos: `Persistence` guarda records estructurados consultables
(con identidad y namespace); `MediaStorage` guarda blobs opacos por id.
Unificarlos forzaría a los adaptadores de registros a manejar binarios y
viceversa. La metadata del medio viaja como `MediaRef` dentro del record:
la consistencia la gestiona el módulo dueño (patrón saga simple: primero
binario, luego metadata; borrado inverso).

## Consecuencias

**Positivas**
- Upload real habilitado sin acoplar photo-feed a ningún proveedor.
- La web podrá funcionar offline-first con IndexedDB y migrar a remoto
  cambiando solo la composición.
- Contratos verificables (contract-tests) para cualquier proveedor futuro
  (S3, GCS, MinIO…).

**Costos**
- Doble escritura (binario + record) sin transaccionalidad: posibles
  huérfanos (mitigado con best-effort + GC futuro).
- `fake-indexeddb` como devDependency de la raíz.
