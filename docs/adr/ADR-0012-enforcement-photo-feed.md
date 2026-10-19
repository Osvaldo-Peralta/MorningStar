# ADR-0012 — Enforcement de autorización: photo-feed + propiedad de fotos

- Status: **Accepted**
- Date: Octubre 2026
- Deciders: Osvaldo Peralta (+ asistencia de IA)
- Relacionados: ADR-0011 (Authorization, cuya deuda §9.1 cierra este ADR), ADR-0002 (dependencias), Baseline v1.0 §3

## Contexto

La Fase 5 construyó el motor de decisiones, pero ningún módulo lo consultaba:
las decisiones solo las consumía la composición (deuda registrada en
ADR-0011 §9). Esta iteración hace que la autorización se sienta en el
producto: photo-feed — el primer módulo de dominio — verifica permisos antes
de cada comando. De paso resuelve un prerrequisito latente: las fotos no
tenían dueño, y sin propiedad los permisos `-own` no significan nada.

## Decisión

### 1. Puerto `Authorizer` en core + `ActorContext`

```ts
// core
interface Authorizer {
  authorize(request: AuthorizationRequestSpec, sessionToken: string)
    : Promise<AuthorizationDecisionSpec>
}
interface ActorContext { sessionToken: string; userId: string }
```

- El puerto vive en **core** (wire-types mínimos): cualquier feature podrá
  exigir autorización sin importar `authorization` (feature ↔ feature sigue
  prohibido). `AuthorizationModule` satisface el puerto **estructuralmente**
  (tipado estructural de TS), sin cambios en su código.
- `CoreContext.authorizer?` opcional (aditivo).

### 2. Frontera de confianza del `ActorContext`

Lo construye SIEMPRE la composición (backend/bootstrap) desde una sesión ya
validada — nunca se acepta de claims crudos del cliente. La identidad real la
prueba el `sessionToken` (que el Authorizer valida contra authentication);
`userId` se usa para stamping de propiedad. Documentado en el contrato de
core.

### 3. photo-feed: enforcement fail-closed (decisión del owner)

Reglas en cada comando (`addPhoto`, `addPhotoFromFile`, `editPhoto`,
`removePhoto` — parámetro opcional `actor?: ActorContext` al final, firmas
aditivas):

| Composición | Llamada | Resultado |
|---|---|---|
| Sin `authorizer` | con o sin actor | comportamiento actual (dev local; web sin login UI) |
| Con `authorizer` | **sin actor** | `PermissionRequiredError` — no existen operaciones anónimas con autorización activa |
| Con `authorizer` | con actor, ALLOW | operación normal |
| Con `authorizer` | con actor, DENY / CONDITIONAL | `PermissionDeniedError` **antes de tocar dominio o infraestructura** (cero efectos colaterales: nada persistido, ningún binario guardado, ningún evento) |

### 4. CONDITIONAL ⇒ denegación con condiciones expuestas

photo-feed no puede cumplir `require-mfa`/`require-step-up` por sí mismo: el
loop de cumplimiento pertenece al composition layer (ADR-0011 §6). Tratar
CONDITIONAL como ALLOW sería half-enforcement; se deniega con
`PermissionDeniedError.decision === 'CONDITIONAL'` y `conditions` expuestas
para que el backend futuro las cumpla y reintente.

### 5. Propiedad de las fotos: `ownerId`

- `PhotoRecord.ownerId?: string` (aditivo), `Photo.ownerId` getter,
  constructor y `toRecord/fromRecord` ampliados.
- `addPhoto/addPhotoFromFile` stampean `ownerId = actor.userId` cuando hay
  actor; el evento `photo:added` gana `ownerId?` (aditivo v1).
- `editPhoto/removePhoto` construyen `resource: { type:'photo', id, ownerId }`
  **antes** del dominio: el evaluador aplica `-own` (member sobre lo suyo) y
  grants directos (moderator/admin sobre cualquiera) sin cambios.
- **Fotos legacy** (pre-ownership): `ownerId` ausente ⇒ los grants `-own` no
  aplican (fail-closed); moderator/admin sí pueden operarlas. Migración
  masiva de dueños: herramienta administrativa futura.

### 6. Permisos usados por photo-feed

| Comando | Permiso |
|---|---|
| `addPhoto` / `addPhotoFromFile` | `photo:create` |
| `editPhoto` | `photo:edit` (member lo tiene como `photo:edit-own`) |
| `removePhoto` | `photo:delete` (member lo tiene como `photo:delete-own`) |

Coherentes con los roles built-in de ADR-0011 §4.

### 7. Web sin enforcement (todavía)

`apps/web` no inyecta `authorizer` hasta que exista la UI de autenticación
(no hay sesiones que propagar). Al construir la UI, la web cableará
`authorizer` + `actor` por comando; el comportamiento actual del frontend no
se rompe.

## Consecuencias

**Positivas**
- Primera funcionalidad de producto gobernada por autorización real de punta
  a punta (demo completa en bootstrap).
- Patrón reusable: los módulos de Fase 6/7 (comunidades, contenido) nacerán
  con `ActorContext` + `Authorizer` desde el día uno.
- Propiedad de fotos habilita feeds multiusuario, notificaciones y audit
  con sujeto.

**Costos / deudas**
- Fotos legacy sin dueño (fail-closed para members).
- Web aún sin enforcement (bloqueado por la UI de login — siguiente
  candidata).
- El loop de cumplimiento de CONDITIONAL sigue pendiente del backend.
