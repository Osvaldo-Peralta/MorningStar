# `@morningstar/persistence-node`

Adaptadores de persistencia y medios para **Node** que implementan los puertos
`PersistenceProvider` y `MediaStorage` de `@morningstar/core` (ADR-0003/0004).

- Estabilidad: **Experimental**
- Dependencias: `@morningstar/core` (contratos), `node:fs/promises`, `node:path`, `node:url`

## `FilePersistenceAdapter`

Persistencia durable de referencia para desarrollo Node: cada namespace es un
archivo JSON (`{ [id]: record }`) dentro de `baseDir`.

```ts
import { FilePersistenceAdapter } from '@morningstar/persistence-node'

const persistence = new FilePersistenceAdapter({ baseDir: './.data' })

const repo = persistence.repository<{ id: string; url: string }>('photo-feed:photos')
await repo.save({ id: 'p1', url: 'https://example.com/1.jpg' })
console.log(await repo.list())
```

### Garantías

- **Escritura atómica**: temp-file + `rename` (un crash no deja JSON corrupto).
- **Namespaces sanitizados**: caracteres no seguros para archivos (como `:`)
  se normalizan a `_`.
- Contrato verificado por los contract-tests compartidos
  (`@morningstar/core/testing`) + tests de durabilidad entre reaperturas.

### Limitaciones (por diseño)

- **Single-process**: no hay locking entre procesos; no es una base de datos.
- No escala a datasets grandes (read-modify-write del archivo completo).
- Producción multiusuario usará el adaptador remoto (Fase 3+), que implementará
  el mismo puerto sin tocar el dominio.

## `FileMediaStorage`

Adaptador durable de **binarios** (puerto `MediaStorage`, ADR-0004): cada
medio vive en `<baseDir>/media/<id>.bin` con su metadata en un sidecar
`<id>.json`.

```ts
import { FileMediaStorage } from '@morningstar/persistence-node'

const media = new FileMediaStorage({ baseDir: './.data' })

const object = await media.put(bytes, 'image/png')
console.log(await media.getUri(object.id)) // file:///…/.data/media/<id>.bin
```

### Garantías

- `getUri` devuelve `file://` URLs (consumibles desde Node; un navegador no
  puede cargarlas — en web se usa `IndexedDbMediaStorage`).
- MediaId sanitizado antes de tocar el filesystem (sin path traversal).
- Metadata con escritura atómica (temp + rename).
- Contrato verificado por `defineMediaStorageContractTests` + test de
  durabilidad entre reaperturas.

### Limitaciones (por diseño)

- **Single-process**, sin control de concurrencia.
- Sin GC de huérfanos (binarios sin referencia); deuda registrada en ADR-0004.
