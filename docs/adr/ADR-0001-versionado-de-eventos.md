# ADR-0001 — Estrategia de versionado de eventos

- Status: **Accepted**
- Date: Octubre 2026
- Deciders: Osvaldo Peralta (+ asistencia de IA)
- Relacionados: `docs/contracts/core.md` (DomainEvent), `docs/adr/ADR-0002-dependencias-entre-modulos.md`

## Contexto

Los eventos son el mecanismo de comunicación interna entre módulos de
MorningStar (lifecycle, dominio y errores viajan por el `EventBus`). Hoy
existen pocos eventos (`module:*`, `photo:*`), pero el roadmap incorpora
Identity, Authentication, comunidades y contenido: el número de eventos y de
consumidores crecerá rápido.

Si un módulo cambia la forma de su payload sin reglas, cualquier consumidor
puede romperse en silencio. Necesitamos una estrategia **antes** de que el
número de módulos aumente (Fase 0 del roadmap).

## Decisión

### 1. Nomenclatura

Todo evento se nombra `<dominio>:<accion>` en minúsculas:

| Prefijo | Módulo dueño | Ejemplos |
|---|---|---|
| `module:` | `@morningstar/core` | `module:registered`, `module:error` |
| `photo:` | `@morningstar/photo-feed` | `photo:added`, `photo:edited` |
| `identity:` *(reservado)* | Identity (Fase 3) | `identity:created` |
| `auth:` *(reservado)* | Authentication (Fase 4) | `auth:login-succeeded` |

Un prefijo pertenece a un único módulo. Ningún módulo emite eventos con
prefijo ajeno. El registro de prefijos vive en `docs/contracts/README.md`.

### 2. Envelope

Todo evento usa el envelope `DomainEvent<TPayload>` del core:
`name`, `category`, `source?`, `payload`, `timestamp` y **`version?`**.

- `version` ausente o `1` ⇒ esquema v1.
- `version` solo se incrementa ante **breaking changes** del payload.

### 3. Evolución compatible (regla por defecto)

Los payloads evolucionan de forma **aditiva**:

- ✅ Permitido: agregar campos opcionales al payload.
- ❌ Prohibido: renombrar, eliminar o cambiar el tipo de campos existentes,
  cambiar la semántica del nombre del evento.

Los consumidores deben tolerar campos desconocidos (forward compatibility).

### 4. Breaking changes

Cuando un cambio aditivo no alcanza:

1. Se define el nuevo esquema como `version: N+1`.
2. Si el cambio es incompatible en el wire, se emite además un evento paralelo
   con sufijo `:v<N+1>` (ej. `photo:added:v2`) durante la transición.
3. **Ventana de deprecación**: el evento viejo se mantiene al menos un ciclo
   de release menor. Se marca `Deprecated` en el contrato del módulo.
4. La eliminación del evento viejo es un breaking change del paquete: sube su
   major (semver del paquete emisor).

### 5. Registro y documentación

- Cada módulo registra sus eventos extendiendo `CoreEventMap` mediante
  *module augmentation* (mecanismo definido en ADR-0002).
- Cada evento se documenta en `docs/contracts/<modulo>.md`: nombre, payload
  exacto, cuándo se emite y versión actual.
- Un evento que no está en el contrato **no existe**: no debe emitirse ni
  consumirse.

## Consecuencias

**Positivas**
- Los consumidores pueden actualizarse de forma independiente de los emisores.
- El Audit Trail (Fase 8) podrá versionar sus registros con el mismo esquema.
- Reglas verificables en revisión de código (contrato + augmentation).

**Costos**
- Duplicación temporal de emisores durante transiciones `:vN`.
- Disciplina documental: todo cambio de evento exige actualizar su contrato.

---

## Enmienda (Octubre 2026) — Alineación con Baseline v1.0 §6

La Baseline v1.0 §6 (frozen) prescribe sufijos de versión explícitos en el
nombre (`_v1`, `_v2`). Este ADR mantiene la **versión en el envelope**
(`DomainEvent.version?`, ausente = v1) con sufijo `:vN` solo al abrir un
breaking change. Justificación:

1. Sufijar los nombres existentes (`photo:added` → `photo:added_v1`) sería en
   sí mismo un breaking change de todos los eventos actuales.
2. Las reglas sustantivas de la Baseline §6 se preservan íntegramente:
   *never modify existing payload* y *only extend* (= §3 evolución aditiva),
   *consumers must tolerate unknown fields* (= forward compatibility de §3).
3. El mecanismo `:vN` de §4 cumple la intención del sufijo explícito: la
   versión aparece en el nombre exactamente cuando coexisten esquemas
   incompatibles.

Status: esta enmienda es la **decisión operativa** para el versionado de
eventos; la Baseline §6 queda como referencia histórica hasta una eventual
Baseline v1.1.
