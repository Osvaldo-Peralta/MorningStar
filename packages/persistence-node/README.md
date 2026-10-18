# `@morningstar/persistence-node`

Adaptadores de persistencia para **Node** que implementan el puerto
`PersistenceProvider` de `@morningstar/core` (ADR-0003).

- Estabilidad: **Experimental**
- Dependencias: `@morningstar/core` (contratos), `node:fs/promises`, `node:path`

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
