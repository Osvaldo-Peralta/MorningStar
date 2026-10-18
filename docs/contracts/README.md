# Contratos públicos de MorningStar

Este directorio documenta los **contratos públicos** de cada paquete: la
superficie que otros módulos y aplicaciones pueden consumir. Si algo no está
aquí (ni en el `index.ts` del paquete), es interno y puede cambiar sin aviso.

## Índice

| Paquete | Contrato | Prefijos de eventos | Estabilidad |
|---|---|---|---|
| `@morningstar/core` | [core.md](./core.md) | `module:` | **Stable** |
| `@morningstar/photo-feed` | [photo-feed.md](./photo-feed.md) | `photo:` | Stable (MVP) |
| `@morningstar/runtime-logger` | [runtime-logger.md](./runtime-logger.md) | — (consumidor `*`) | Stable (MVP) |
| `@morningstar/identity` | [identity.md](./identity.md) | `identity:` | Stable |
| `@morningstar/persistence-node` | [README del paquete](../../packages/persistence-node/README.md) | — (infraestructura) | Experimental |

Plantilla para módulos nuevos: [TEMPLATE.md](./TEMPLATE.md)

## Registro de prefijos de eventos

Un prefijo pertenece a un único módulo (ADR-0001). Reservados:

| Prefijo | Dueño | Estado |
|---|---|---|
| `module:` | core | en uso |
| `photo:` | photo-feed | en uso |
| `identity:` | identity | en uso |
| `auth:` | Authentication (Fase 4) | reservado |
| `media:` | Media Storage (Fase 2) | reservado |
| `audit:` | Audit Trail (Fase 8) | reservado |

## Niveles de estabilidad

- **Experimental**: puede romper en cualquier commit; no construir encima.
- **Stable**: solo cambios aditivos (ADR-0001 §3); breaking changes requieren
  ADR + ventana de deprecación + bump major del paquete.
- **Frozen**: contrato cerrado por un RFC de arquitectura (ej. Baseline v1.0);
  solo cambia mediante un nuevo RFC/ADR que lo reemplace.

## Reglas de cambio

1. Todo cambio de contrato va en el **mismo PR** que el cambio de código.
2. Cambios en contratos Stable/Frozen siguen ADR-0001 (evolución aditiva) y
   ADR-0002 (dependencias).
3. Los eventos se versionan según ADR-0001; el campo `version` del envelope
   `DomainEvent` es el mecanismo de transición.
