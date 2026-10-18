# ADR-0011 — Authorization: SecurityContext, roles y evaluación pura

- Status: **Accepted**
- Date: Octubre 2026
- Deciders: Osvaldo Peralta (+ asistencia de IA)
- Relacionados: Baseline v1.0 §3 (frozen), ADR-0002 (dependencias), ADR-0007 (patrón de puertos), roadmap Fase 5

## Contexto

La Fase 5 pide roles/permisos, `SecurityContext` y evaluación
ALLOW/DENY/CONDITIONAL con la regla de oro de la Baseline §3: **"No DB access
inside evaluation"**. Es el núcleo de decisión que consumirá toda la
superapp (comunidades, contenido, economía) y el que el Risk Engine (Fase 8)
y el Audit Trail alimentarán.

## Decisión

### 1. Dos niveles: ensamblado con I/O, evaluación pura

- `AuthorizationModule.buildContext(sessionToken)` / `authorize(request, token)`:
  asíncronos, hacen I/O **solo** para ensamblar el `SecurityContext`
  (sesión + actor + roles).
- `evaluate(request, context)` y `DefaultPolicyEvaluator.evaluate`:
  **síncronos, deterministas, cero I/O** — la regla de la Baseline se cumple
  por construcción (el evaluador ni siquiera recibe repositorios).

### 2. `SecurityContext` fiel a la Baseline §3

`actorId, roles, accountStatus, accountType, verifiedAttributes, sessionInfo,
riskLevel`. Los wire-values de identity y el `RiskLevel` de authentication se
duplican como strings (desacoplamiento feature ↔ feature, mismo patrón que
`LoginRelevantAccountStatus` en ADR-0007). `riskLevel` llega desde el
`riskSnapshot` de la sesión: **'UNKNOWN' hasta Fase 8**, donde el Risk Engine
lo poblará sin cambiar este contrato ("Consumes RiskAssessment" queda
cableado y dormido).

### 3. Permisos como strings `recurso:accion` (decisión del owner)

- Wildcards: `'*'` y `'recurso:*'` (prefijo, incluidos sub-niveles).
- Propiedad: sufijo **`-own`** (`'photo:delete-own'`, `'media:*-own'`):
  otorga solo cuando `resource.ownerId === actorId`. Sin `ownerId` en la
  petición, el grant `-own` no aplica (no se puede probar la propiedad ⇒
  default-deny).
- Simples, auditables, wire-friendly: viajan tal cual en eventos y futuras
  políticas de comunidad (Fase 6).

### 4. Roles built-in + default por estado (decisión del owner)

`guest` (∅), `member` (default de toda cuenta **ACTIVE** sin asignación
explícita), `creator`, `moderator`, `admin` (`'*'`). Cuentas no-ACTIVE
caen en `guest` — aunque la regla 1 del evaluador ya las DENiega.
`extraRoles` amplía por composición; colisionar con un built-in lanza.
Las asignaciones explícitas se persisten en
`authorization:role-assignments` (un record por usuario, reemplazo completo
en `assignRoles`).

### 5. Tabla de reglas del evaluador (orden fijo)

| # | Condición | Decisión |
|---|---|---|
| 1 | `accountStatus !== 'ACTIVE'` | DENY `account-status:<X>` |
| 2 | `riskLevel === 'CRITICAL'` | DENY `risk-level:CRITICAL` |
| 2b | `riskLevel === 'HIGH'` | CONDITIONAL `['require-step-up']` |
| 3 | ningún rol otorga el permiso | DENY `no-role-grants-permission` |
| 4 | permiso sensible otorgado | CONDITIONAL `['require-mfa']` |
| 5 | otorgado | ALLOW `role:<nombre>` |

**Default-deny** absoluto: lo que no está explícitamente permitido, se
niega. `reason` es estable y legible por máquina (insumo del Audit Trail).

### 6. CONDITIONAL semántico

CONDITIONAL no es un "tal vez": es **ALLOW pendiente de condiciones
verificables** que el composition layer debe cumplir antes de ejecutar:
- `'require-mfa'`: prueba de segundo factor reciente (permisos sensibles —
  materializa *"Re-auth required for sensitive changes"*, Baseline §1).
  Lista default: `account:*`, `user:suspend`, `user:ban`, `role:*`
  (configurable por instancia).
- `'require-step-up'`: re-autenticación elevada por riesgo (Fase 8).
- `'require-ownership'`: reservada para políticas futuras que pidan evidencia
  de propiedad explícita.

Quién cumple las condiciones (el "enforcement loop") se definirá con el
backend; el evaluador solo las declara.

### 7. Puertos de ensamblado (cero imports entre features)

`SessionValidatorPort` (cableado con `AuthenticationModule.validateSession`)
y `ActorDirectoryPort` (con `IdentityModule.getUser` + mapeo
`emailVerified → verifiedAttributes: ['email']`). La composición vive en
bootstrap/backend (ejemplo de referencia incluido).

### 8. Eventos `authz:` (prefijo nuevo)

`authz:decision` en **cada** `authorize()` (decisión del owner): `{actorId,
permission, decision, reason}` — el Audit Trail de Fase 8 nacerá con su
fuente ya emitiendo. `authz:role-assigned` / `authz:role-revoked` para los
comandos de administración. La evaluación pura (`evaluate`) NO emite: es una
función, el emisor es el flujo `authorize`.

### 9. Deuda registrada

- **Enforcement en los módulos de dominio** (photo-feed consultando
  autorización antes de comandos): requiere un puerto `PermissionChecker`
  inyectado — candidata a Iteración 7b.
- Cumplimiento de condiciones (step-up/MFA proof) con backend + Fase 8.
- Políticas dinámicas por comunidad (Fase 6): el modelo de roles/permisos ya
  las admite vía `extraRoles` + scoping de asignaciones.
- Cache de ensamblado de contexto para hot-paths (hoy: 2 lecturas por
  authorize).

## Consecuencias

**Positivas**
- Decisión formal, pura y testeable exhaustivamente (la tabla de reglas es
  el contrato).
- Risk Engine y Audit encajan sin cambios de contrato (riskLevel cableado,
  decisiones emitidas).
- Ninguna dependencia entre features: el grafo sigue siendo feature → core.

**Costos**
- Cada `authorize()` hace I/O de ensamblado (mitigable con cache futura).
- Los módulos de dominio todavía no consultan autorización (deuda 7b): las
  decisiones hoy las consume la composición/UI.
