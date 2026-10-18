# ADR-0003 — Persistencia multiusuario desacoplada

- Status: **Accepted**
- Date: Octubre 2026
- Deciders: Osvaldo Peralta (+ asistencia de IA)
- Relacionados: `docs/contracts/core.md` §3.5, `docs/contracts/photo-feed.md` §4, ADR-0002 (dependencias), roadmap Fase 1

## Contexto

Hasta la Fase 1, la única persistencia era el puerto `Storage` (clave-valor).
PhotoFeed guardaba un `string[]` de URLs bajo `photo-feed:data` y la hidratación
**regeneraba ids y timestamps en cada sesión**: identidad inestable, imposible
de referenciar desde otros módulos (comentarios, likes, audit) e inviable para
multiusuario.

El roadmap (Fase 1) pide: *"Definir el puerto de persistencia para escenarios
multiusuario y preparar un adaptador remoto. Mantener LocalStorage como
adaptador local de desarrollo"*, sin elegir todavía la tecnología definitiva.

## Decisión

### 1. Nuevo puerto `Persistence` (en `@morningstar/core`)

```ts
interface PersistedRecord { readonly id: string }

interface Repository<T extends PersistedRecord> {
  get(id: string): Promise<T | null>
  save(record: T): Promise<T>        // upsert por id
  remove(id: string): Promise<boolean>
  list(): Promise<T[]>
}

interface PersistenceProvider {
  repository<T extends PersistedRecord>(namespace: string): Repository<T>
}
```

`CoreContext` gana el miembro **opcional** `persistence?: PersistenceProvider`
(cambio aditivo sobre contrato Stable). Los módulos que lo requieren lo
declaran en su contrato y fallan en `init` con error explícito si falta
(camino único en photo-feed; sin doble camino Storage/Repository).

### 2. Se persisten *records*, nunca agregados

Un `PersistedRecord` es datos planos JSON-serializables con identidad estable.
El mapeo agregado ↔ record pertenece al módulo dueño del dominio
(`Photo.toRecord()` / `Photo.fromRecord()`). Consecuencia: cualquier adaptador
(JSON, SQL, object storage) funciona sin que el dominio conozca la tecnología
(hexagonal, principio del roadmap).

### 3. Namespaces

Cada colección vive bajo un namespace `<modulo>:<recurso>`
(ej. `photo-feed:photos`). Los adaptadores traducen el namespace a su medio
(clave prefijada, archivo, tabla/colección).

### 4. Multiusuario sin Identity (todavía)

El puerto no conoce usuarios: el **scope se compone por fuera**. Hoy existe un
provider global; cuando llegue Identity (Fase 3), la composición creará
providers acotados por usuario/sesión (decoradores o factorías de provider)
**sin cambiar la forma del puerto**. Los módulos de dominio seguirán viendo un
`Repository<T>` idéntico.

### 5. Matriz de adaptadores

| Adaptador | Paquete | Ámbito | Estado |
|---|---|---|---|
| `InMemoryPersistenceAdapter` | core | tests, bootstrap, mocks | ✅ Fase 1 |
| `LocalStoragePersistenceAdapter` | core | desarrollo web (navegador) | ✅ Fase 1 |
| `FilePersistenceAdapter` (JSON en disco, escritura atómica) | `@morningstar/persistence-node` | desarrollo Node; referencia durable | ✅ Fase 1 |
| Remoto (DB / object storage) | por decidir | producción multiusuario | Fase 3+ (requiere backend e Identity) |

Todo adaptador DEBE pasar los contract-tests compartidos
(`defineRepositoryContractTests`, exportado por `@morningstar/core/testing`).

**Por qué no `node:sqlite` ahora:** la CI corre Node 20 (donde no existe) y en
Node 22 es experimental; además elegir DB es exactamente lo que el roadmap
difiere ("la tecnología concreta todavía debe decidirse"). El puerto ya está
fijado; un adaptador SQLite/Postgres futuro es un paquete nuevo que pasa los
contract-tests, sin tocar dominio ni core.

### 6. `Storage` (KV) se conserva

`Storage` sigue siendo el puerto para configuración, flags y preferencias
(clave-valor simple). `Persistence` es para entidades con identidad. Son
preocupaciones distintas y conviven en `CoreContext`.

### 7. Migración legacy (una vez)

`PhotoFeedModule.init` importa por única vez las URLs de `photo-feed:data`
(esquema anterior) al repositorio `photo-feed:photos` y descarta la clave
legacy. Los ids se regeneran por última vez para esas fotos; a partir de ahí
la identidad es estable.

## Consecuencias

**Positivas**
- Identidad estable: otros módulos podrán referenciar `photoId` (Fases 6-8).
- Tecnología de producción abierta: el puerto congelado permite decidir DB más
  tarde sin reescribir dominio (principio "infraestructura sustituible").
- Contract-tests: cualquier adaptador nuevo se valida contra el mismo contrato.

**Costos**
- Doble puerto en `CoreContext` (Storage + Persistence) hasta que madure el
  sistema.
- La migración legacy añade código temporal en photo-feed (se podrá eliminar
  cuando no queden navegadores con datos viejos).
