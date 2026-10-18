# ADR-0002 — Reglas de dependencias entre módulos

- Status: **Accepted**
- Date: Octubre 2026
- Deciders: Osvaldo Peralta (+ asistencia de IA)
- Relacionados: `docs/adr/ADR-0001-versionado-de-eventos.md`, `docs/architecture/baseline-v1.md`

## Contexto

Durante la Iteración 0 se detectó y corrigió una dependencia circular real:
`@morningstar/core` importaba payloads de `@morningstar/photo-feed` para
poblar `CoreEventMap`, mientras photo-feed dependía de core. Con TypeScript
Project References el ciclo se volvió inviable y se resolvió invirtiendo la
dependencia (augmentation). El roadmap sumará muchos módulos (Identity, Auth,
Messaging, Communities, Media, Economy); sin reglas explícitas, el grafo de
dependencias se degradará.

## Decisión

### 1. Dirección única: feature → core

```
            ┌────────────────────────────┐
            │      @morningstar/core     │   (no importa NINGÚN feature)
            │  ModuleRegistry · EventBus │
            │  CoreContext · puertos     │
            └──────▲──────▲──────▲───────┘
                   │      │      │
        ┌──────────┴─┐ ┌──┴───────────┐ ┌┴────────────────┐
        │ photo-feed │ │runtime-logger│ │ identity (F3)…  │
        └────────────┘ └──────────────┘ └─────────────────┘
             (los features NUNCA se importan entre sí)
```

- `core` define contratos y puertos; **nunca** importa módulos de funcionalidad.
- Cada feature depende solo de `core`.
- El cumplimiento es mecánico: las `references` de cada `tsconfig.json`
  declaran exactamente las dependencias permitidas; `tsc -b` falla si se
  agregan imports fuera del grafo.

### 2. Entre features: eventos y puertos, nunca imports

Dos módulos de funcionalidad no se conocen. Se integran exclusivamente por:

- **EventBus**: eventos de dominio versionados (ADR-0001). Ejemplo: cuando
  exista Audit, consumirá `photo:*` sin importar photo-feed.
- **Puertos del CoreContext**: capacidades abstractas (Storage, Permission,
  Logger) provistas por la composición (bootstrap), no por otro feature.

### 3. Extensión del contrato de eventos: module augmentation

Los features aportan sus eventos al mapa global extendiendo `CoreEventMap`:

```ts
// dentro del módulo feature (ej. photo-feed/PhotoEventMap.ts)
declare module '@morningstar/core' {
  interface CoreEventMap {
    'photo:added': PhotoAddedPayload
  }
}
```

Consecuencias:
- El core permanece cerrado a modificaciones y abierto a extensión (OCP).
- El archivo de augmentation es parte del contrato público del módulo y se
  exporta desde su `index.ts` (si no se importa, los tipos no se extienden).

### 4. API pública única: la raíz del paquete

- Cada paquete expone su contrato solo por su `index.ts`, publicado mediante
  el campo `exports` de su `package.json`.
- **Deep imports prohibidos** (`@morningstar/core/module/ModuleRegistry`):
  `exports` los bloquea en Node; en bundlers (vite) se respetan por convención
  y revisión de código.
- `bootstrap` y la web consumen únicamente APIs públicas.

### 5. Utilidades de test compartidas (deuda registrada)

Hoy los tests de photo-feed usan `packages/core/module/__mocks__/*` mediante
ruta relativa (`../../core/module/__mocks__/mockCoreContext.js`), cruzando el
límite de paquete. Se acepta **temporalmente** porque:
- son solo tests (no runtime), y
- los mocks prueban el contrato del core tal como lo consume un feature.

Deuda: crear `@morningstar/testing` (paquete con mocks/contract-test-utils)
cuando exista un tercer módulo que los necesite (candidato natural: Identity,
Fase 3).

### 6. Checklist para módulos nuevos

1. Crear el paquete con su `tsconfig.json` (composite) y `references` **solo**
   a `core` (u otro si un ADR lo justifica).
2. Declarar dependencias reales en su `package.json`.
3. Reservar su prefijo de eventos en `docs/contracts/README.md`.
4. Redactar su contrato con `docs/contracts/TEMPLATE.md` antes/junto a la
   implementación.
5. Exponer todo por `index.ts` + `exports`.

## Consecuencias

**Positivas**
- Grafo acíclico garantizado por el compilador.
- Sustituir o eliminar un feature no rompe a otros features ni al core.
- El core deja de ser "punto de acoplamiento universal" (principio del roadmap).

**Costos**
- La integración cruzada exige diseñar eventos (más upfront thinking).
- Los mocks compartidos requieren el paquete `@morningstar/testing` a futuro.
