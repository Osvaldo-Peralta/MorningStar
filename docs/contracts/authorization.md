# Contrato — `@morningstar/authorization`

- Estabilidad: **Experimental** (promoverá a Stable cuando exista al menos un
  consumidor de enforcement — Iteración 7b)
- Versión del paquete: 0.1.0
- Dueño de prefijos de eventos: `authz:`
- Dependencias: `@morningstar/core` (única — ADR-0002)

Evaluación formal de permisos bajo el modelo ALLOW/DENY/CONDITIONAL de la
Baseline v1.0 §3, con la regla de oro **"No DB access inside evaluation"**.
Decisiones de diseño en ADR-0011.

---

## 1. API pública — `AuthorizationModule`

```ts
export class AuthorizationModule implements AppModule {
  readonly id = 'authorization'
  readonly version: string
  state: ModuleState

  constructor(options: AuthorizationModuleOptions)
  // options: { sessionValidator: SessionValidatorPort,     ← obligatorio
  //            actorDirectory: ActorDirectoryPort,         ← obligatorio
  //            extraRoles?: RoleDefinition[],
  //            sensitivePermissions?: string[] }

  evaluate(request, context): AuthorizationResult            // SÍNCRONO y PURO
  authorize(request, sessionToken): Promise<AuthorizationResult>
  buildContext(sessionToken): Promise<SecurityContext | null>
  getRoles(userId, accountStatus?): Promise<readonly string[]>
  assignRoles(userId, roles): Promise<void>                  // comando admin
  revokeRole(userId, role): Promise<void>                    // comando admin
  listRoles(): RoleDefinition[]
}
```

**`init(context)` requiere `context.persistence`** (asignaciones de roles).

| Método | Precondiciones | Comportamiento | Errores |
|---|---|---|---|
| `evaluate(request, context)` | — | Evaluación pura (sin I/O, sin eventos): tabla de reglas de ADR-0011 §5 | — (nunca lanza por datos: default-deny) |
| `authorize(request, sessionToken)` | módulo inicializado | Ensambla contexto (sesión→actor→roles), evalúa y emite `authz:decision`. Sesión inválida ⇒ `{DENY, 'invalid-session'}` (nunca excepción) | `Error('Not Initialized')` |
| `assignRoles(userId, roles)` | todos los roles conocidos | Reemplaza la asignación completa; persiste; emite `authz:role-assigned` | `UnknownRoleError` |
| `revokeRole(userId, role)` | el rol está asignado | Lo elimina de la asignación; emite `authz:role-revoked` | `RoleNotAssignedError` |
| `getRoles(userId)` | — | Asignación explícita o default por estado (`ACTIVE`→`member`, otro→`guest`) | — |

## 2. Modelo de decisión

```ts
export interface AuthorizationRequest {
  readonly permission: string                     // 'recurso:accion'
  readonly resource?: { type: string; id?: string; ownerId?: string }
}

export interface AuthorizationResult {
  readonly decision: 'ALLOW' | 'DENY' | 'CONDITIONAL'
  readonly reason: string                         // estable, legible por máquina
  readonly matchedRole?: string
  readonly conditions?: readonly AuthorizationCondition[]
}
```

**Tabla de reglas (orden fijo, ADR-0011 §5):** estado no-ACTIVE ⇒ DENY ·
riesgo CRITICAL ⇒ DENY · riesgo HIGH ⇒ CONDITIONAL `require-step-up` ·
sin rol que otorgue ⇒ DENY (`no-role-grants-permission`) · permiso sensible
otorgado ⇒ CONDITIONAL `require-mfa` · otorgado ⇒ ALLOW (`role:<nombre>`).

**Permisos:** strings `recurso:accion`; wildcards `'*'` y `'recurso:*'`;
variante `-own` exige `resource.ownerId === actorId`.

**CONDITIONAL** = ALLOW pendiente de condiciones verificables
(`require-mfa`, `require-step-up`, `require-ownership`); cumplirlas es tarea
del composition layer (deuda documentada).

## 3. `SecurityContext` (campos exactos de la Baseline §3)

```ts
export interface SecurityContext {
  readonly actorId: string
  readonly roles: readonly string[]
  readonly accountStatus: string
  readonly accountType: string
  readonly verifiedAttributes: readonly string[]   // 'email' hoy
  readonly sessionInfo: SessionInfoRef | null
  readonly riskLevel: AuthorizationRiskLevel       // 'UNKNOWN' hasta Fase 8
}
```

## 4. Roles built-in

| Rol | Permisos |
|---|---|
| `guest` | — (cuentas no-ACTIVE) |
| `member` *(default ACTIVE)* | `photo:create/list/view`, `photo:edit-own`, `photo:delete-own`, `profile:view`, `profile:edit-own`, `msg:send`, `msg:read`, `msg:edit-own`, `msg:delete-own` |
| `creator` | `media:publish`, `media:edit-own`, `media:delete-own`, `content:publish` |
| `moderator` | `photo:hide`, `photo:delete`, `content:review`, `user:suspend`¹, `msg:delete` |
| `admin` | `*` |

¹ Sensible: su decisión es CONDITIONAL `require-mfa`.
Sensibles default: `account:*`, `user:suspend`, `user:ban`, `role:*`.

## 5. Puertos de ensamblado (cableados por la composición)

```ts
export interface SessionValidatorPort {
  validateSession(token): Promise<{ userId; sessionId; deviceFingerprint;
    issuedAt; expiresAt; riskLevel? } | null>     // ← authentication
}
export interface ActorDirectoryPort {
  getActor(userId): Promise<{ accountStatus; accountType;
    verifiedAttributes } | null>                  // ← identity
}
```

Ejemplo de referencia de cableado: `bootstrap.ts`.

## 6. Eventos emitidos (ADR-0001, prefijo `authz:`)

| Evento | Cuándo | Payload |
|---|---|---|
| `authz:decision` | en cada `authorize()` (no en `evaluate`) | `{ actorId, permission, decision, reason }` |
| `authz:role-assigned` | tras `assignRoles` | `{ userId, roles }` |
| `authz:role-revoked` | tras `revokeRole` | `{ userId, role }` |

## 7. Persistencia

| Namespace | Record | Contenido |
|---|---|---|
| `authorization:role-assignments` | `RoleAssignmentRecord` (`id` = userId) | `{ roles, updatedAt }` — ausencia ⇒ default por estado |

## 8. Deuda conocida

- ~~Enforcement en módulos de dominio~~: **cerrada para photo-feed** en la
  Iteración 7b (ADR-0012, puerto `Authorizer` de core). Los módulos futuros
  nacerán con enforcement.
- Enforcement loop de condiciones (`require-mfa`/`require-step-up`): con
  backend/Fase 8 (photo-feed trata CONDITIONAL como denegación con
  condiciones expuestas).
- ~~Enforcement en la web~~: **cerrada en 8a** — la web cablea `authorizer` y
  propaga `ActorContext` en los comandos de PhotoFeed (ADR-0013).
- Cache del ensamblado de contexto para hot-paths.
- Políticas dinámicas por comunidad: Fase 6 (el modelo lo admite vía
  `extraRoles` + scoping).
