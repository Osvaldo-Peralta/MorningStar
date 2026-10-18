# Contrato — `@morningstar/identity`

- Estabilidad: **Stable** (Fase 3 cerrada — promovido desde Experimental)
- Versión del paquete: 0.1.0
- Dueño de prefijos de eventos: `identity:`
- Dependencias: `@morningstar/core` (única — ADR-0002), `nanoid`

Gestiona la identidad de usuario como dominio independiente de authentication
y authorization (Baseline v1.0 §1, Fase 3 del roadmap), incluyendo el ciclo de
vida completo de verificación por email. Decisiones de diseño en ADR-0005
(dominio) y ADR-0006 (verificación).

---

## 1. API pública — `IdentityModule`

```ts
export class IdentityModule implements AppModule {
  readonly id = 'identity'
  readonly version: string
  state: ModuleState

  constructor(options?: IdentityModuleOptions)   // { tokenTtlMs?: number } — default 24 h

  registerUser(input: RegisterUserInput): Promise<UserSnapshot>
  changeStatus(userId: string, to: AccountStatus, reason?: string): Promise<UserSnapshot>
  updateDisplayName(userId: string, displayName: string): Promise<UserSnapshot>
  changeAccountType(userId: string, to: AccountType): Promise<UserSnapshot>
  requestEmailVerification(userId: string): Promise<void>
  confirmEmail(token: string): Promise<UserSnapshot>
  getUser(userId: string): Promise<UserSnapshot | null>
  getByUsername(username: string): Promise<UserSnapshot | null>   // case-insensitive
  getByEmail(email: string): Promise<UserSnapshot | null>         // case-insensitive (ADR-0006)
  listUsers(): Promise<UserSnapshot[]>
}
```

**Requisitos de `init(context)`:**
- `context.persistence` — obligatorio (camino único, ADR-0003).
- `context.email` — requerido solo por `requestEmailVerification` (error
  explícito al invocarlo si falta).

| Método | Precondiciones | Comportamiento | Errores |
|---|---|---|---|
| `registerUser({username, email, displayName, accountType?})` | username, email y displayName válidos; username y email libres | Normaliza → verifica unicidad (índices) → crea agregado en `PENDING_VERIFICATION` (default `PERSONAL`, `emailVerified: false`) → persiste usuario + índices → emite `identity:registered` | `InvalidUsernameError`, `InvalidEmailError`, `InvalidDisplayNameError`, `UsernameAlreadyTakenError`, `EmailAlreadyRegisteredError`, `Error('Not Initialized')` |
| `changeStatus(userId, to, reason?)` | usuario existe; transición permitida | Transiciona, persiste y emite `identity:status-changed` con `{from, to, reason?}` | `UserNotFoundError`, `InvalidStatusTransitionError` |
| `updateDisplayName(userId, displayName)` | usuario existe; displayName válido | Actualiza, persiste y emite `identity:profile-updated` | `UserNotFoundError`, `InvalidDisplayNameError` |
| `changeAccountType(userId, to)` | usuario existe; conversión permitida | Convierte, persiste y emite `identity:type-changed` | `UserNotFoundError`, `InvalidAccountTypeConversionError` |
| `requestEmailVerification(userId)` | usuario existe; `context.email` presente | Invalida tokens activos anteriores → genera token (256-bit, TTL 24 h) → persiste **solo su hash** → envía email con enlace → emite `identity:verification-requested` | `UserNotFoundError`, `Error("...requiere 'context.email'...")` |
| `confirmEmail(token)` | token válido, no consumido, no invalidado, no expirado | Consume el token (single-use) → `emailVerified: true` → **solo** `PENDING_VERIFICATION → ACTIVE` → emite `identity:status-changed` (si aplicó) y `identity:email-verified` | `InvalidVerificationTokenError`, `TokenAlreadyUsedError`, `TokenInvalidatedError`, `TokenExpiredError` |
| `getUser` / `getByUsername` / `getByEmail` / `listUsers` | módulo inicializado | Consultas de solo lectura; `null` cuando no existe. `getByUsername`/`getByEmail` resuelven case-insensitive vía índices | `Error('Not Initialized')` |

Orden de operaciones en cada comando: validación de dominio → persistencia →
evento. Los comandos devuelven el `UserSnapshot` resultante.

## 2. Dominio

### `User` (agregado)

```ts
export class User {
  readonly id: string
  get username(): string          // normalizado
  get email(): string             // normalizado
  get displayName(): string
  get accountType(): AccountType
  get accountStatus(): AccountStatus
  get verificationFlags(): VerificationFlags   // { emailVerified: boolean }
  get createdAt(): number
  get updatedAt(): number

  static create(input: CreateUserInput): User  // nace en PENDING_VERIFICATION
  changeStatus(to): AccountStatus              // devuelve el estado anterior
  updateDisplayName(displayName): string       // devuelve el valor anterior
  changeAccountType(to): AccountType           // devuelve el tipo anterior
  markEmailVerified(): void
  toRecord(): UserRecord
  static fromRecord(record: UserRecord): User
}
```

Estado interno con `#privates` (no se filtra al serializar). **Los consumidores
externos NO reciben el agregado**: la API pública expone `UserSnapshot`
(datos planos de solo lectura), que es la frontera que protege los internal
flags mencionados en la Baseline.

### `AccountStatus` y política de transición

```ts
export const AccountStatus = {
  PendingVerification: 'PENDING_VERIFICATION',
  Active: 'ACTIVE',
  Suspended: 'SUSPENDED',
  Deactivated: 'DEACTIVATED',
  Banned: 'BANNED',
} as const
```

| Desde | Hacia permitido | Notas (Baseline v1.0 §1) |
|---|---|---|
| `PENDING_VERIFICATION` | `ACTIVE`, `SUSPENDED`, `DEACTIVATED`, `BANNED` | → `ACTIVE` vía `confirmEmail` (regla: "VERIFIED occurs upon email confirmation") |
| `ACTIVE` | `SUSPENDED`, `DEACTIVATED`, `BANNED` | — |
| `SUSPENDED` | `ACTIVE`, `DEACTIVATED`, `BANNED` | → `ACTIVE` solo por comando explícito (admin); **la verificación de email NUNCA reactiva** |
| `DEACTIVATED` | `ACTIVE`, `BANNED` | → `ACTIVE` requerirá re-auth en Fase 4 |
| `BANNED` | *(terminal)* | unban futuro exigiría ADR + Audit (ADR-0005) |

Transición al mismo estado: rechazada. Helpers públicos: `canTransition`,
`assertTransition`, `STATUS_TRANSITIONS`.

### `AccountType` y política de conversión

`PERSONAL ↔ CREATOR` permitido; hacia/desde `OFFICIAL`/`GOVERNMENT` bloqueado
hasta definir su flujo de verificación. Cuenta nueva: `PERSONAL` por defecto.

### Verificación de email (ADR-0006)

- Token: 256 bits (`crypto.getRandomValues`, base64url); se persiste **solo el
  hash SHA-256** como `id` del record (lookup O(1), el claro nunca se guarda).
- TTL: 24 h por defecto (`EMAIL_VERIFICATION_TTL_MS`), inyectable vía
  `IdentityModuleOptions.tokenTtlMs`.
- Single active token: una nueva solicitud invalida los anteriores.
- Single-use: el token se consume antes de los efectos de dominio.
- Regla SUSPENDED: `confirmEmail` marca `emailVerified` pero **no** cambia el
  estado de una cuenta suspendida (ni de ningún estado que no sea
  `PENDING_VERIFICATION`).

### Políticas de perfil

- **username**: trim + lowercase; `[a-z0-9]`; 3–32; único case-insensitive.
- **email**: trim + lowercase; `algo@algo.tld` (pragmático); máx 254; único
  case-insensitive.
- **displayName**: Unicode completo; 1–100 code points; trim.

### Tipos de soporte

```ts
export interface VerificationFlags { readonly emailVerified: boolean }

export interface UserRecord extends PersistedRecord {
  readonly username: string
  readonly email: string
  readonly displayName: string
  readonly accountType: AccountType
  readonly accountStatus: AccountStatus
  readonly verificationFlags: VerificationFlags
  readonly createdAt: number
  readonly updatedAt: number
}

export interface EmailVerificationTokenRecord extends PersistedRecord {
  readonly userId: string
  readonly email: string
  readonly createdAt: number
  readonly expiresAt: number
  readonly consumedAt?: number
  readonly invalidatedAt?: number
}

export interface UserSnapshot { /* mismos campos que UserRecord */ }
export interface RegisterUserInput { username; email; displayName; accountType? }
```

## 3. Eventos emitidos (ADR-0001, prefijo `identity:`)

Todos con `category: 'domain'`, `source: { moduleId: 'identity', entity: 'user', entityId }`, v1.

| Evento | Cuándo | Payload |
|---|---|---|
| `identity:registered` | tras crear usuario + índices | `{ userId, username, accountType, accountStatus }` |
| `identity:status-changed` | tras transición válida (incluida la de `confirmEmail`) | `{ userId, from, to, reason? }` |
| `identity:profile-updated` | tras actualizar displayName | `{ userId, displayName }` |
| `identity:type-changed` | tras conversión de tipo válida | `{ userId, from, to }` |
| `identity:verification-requested` | tras generar token y enviar email | `{ userId, email, expiresAt }` |
| `identity:email-verified` | tras confirmación exitosa | `{ userId, email }` |

El módulo registra estos eventos en `CoreEventMap` por *module augmentation*
(`IdentityEventMap.ts`, exportado desde el índice público).

## 4. Persistencia

| Namespace | Record | Contenido |
|---|---|---|
| `identity:users` | `UserRecord` | agregados de usuario |
| `identity:usernames` | `{ id: usernameNormalizado, userId }` | índice de unicidad O(1) |
| `identity:emails` | `{ id: emailNormalizado, userId }` | índice de unicidad O(1) |
| `identity:email-tokens` | `EmailVerificationTokenRecord` (`id` = SHA-256 del token) | tokens de verificación |

Orden de escritura en registro: usuario → índices (fallo intermedio = dato
sin índice, recuperable; nunca índice colgado). Identidad estable entre
sesiones (garantías del puerto Persistence).

## 5. Permisos y configuración

- No solicita permisos del puerto `Permissions`.
- No lee claves de `CoreConfig`. `IdentityModuleOptions.tokenTtlMs` es la
  única configuración del módulo.

## 6. Deuda conocida

- **Re-auth para cambios sensibles** (Baseline): llegará con Authentication
  (Fase 4); los comandos sensibles incorporarán entonces el contexto de actor.
- Conversiones a `OFFICIAL`/`GOVERNMENT` bloqueadas hasta definir su flujo de
  verificación.
- `BANNED` terminal: el unban se definirá por ADR junto al Audit Trail (Fase 8).
- Sin rate-limiting en `requestEmailVerification` (vector de spam) — se
  abordará con Risk Engine / Authentication (ADR-0006).
- Sin GC de tokens expirados/consumidos; búsqueda de tokens por usuario con
  `list()` + filtro (índice secundario cuando haya volúmenes reales).
- `VERIFICATION_LINK_BASE` es placeholder hasta que exista la app pública.
