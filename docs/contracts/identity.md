# Contrato — `@morningstar/identity`

- Estabilidad: **Experimental** (promoverá a Stable al cerrar la Fase 3 con la
  verificación por email, Iteración 5)
- Versión del paquete: 0.1.0
- Dueño de prefijos de eventos: `identity:`
- Dependencias: `@morningstar/core` (única — ADR-0002), `nanoid`

Gestiona la identidad de usuario como dominio independiente de authentication
y authorization (Baseline v1.0 §1, Fase 3 del roadmap). Decisiones de diseño
en ADR-0005.

---

## 1. API pública — `IdentityModule`

```ts
export class IdentityModule implements AppModule {
  readonly id = 'identity'
  readonly version: string
  state: ModuleState

  registerUser(input: RegisterUserInput): Promise<UserSnapshot>
  changeStatus(userId: string, to: AccountStatus, reason?: string): Promise<UserSnapshot>
  updateDisplayName(userId: string, displayName: string): Promise<UserSnapshot>
  changeAccountType(userId: string, to: AccountType): Promise<UserSnapshot>
  getUser(userId: string): Promise<UserSnapshot | null>
  getByUsername(username: string): Promise<UserSnapshot | null>   // case-insensitive
  listUsers(): Promise<UserSnapshot[]>
}
```

**`init(context)` requiere `context.persistence`** (camino único, ADR-0003);
si falta, lanza error explícito que el `ModuleRegistry` traduce a
`module:error` + `ModuleLifecycleError`.

| Método | Precondiciones | Comportamiento | Errores |
|---|---|---|---|
| `registerUser({username, displayName, accountType?})` | username y displayName válidos; username libre | Normaliza username → verifica unicidad (índice) → crea agregado en `PENDING_VERIFICATION` (default `PERSONAL`, `emailVerified: false`) → persiste usuario + índice → emite `identity:registered` | `InvalidUsernameError`, `InvalidDisplayNameError`, `UsernameAlreadyTakenError`, `Error('Not Initialized')` |
| `changeStatus(userId, to, reason?)` | usuario existe; transición permitida por `StatusTransitionPolicy` | Transiciona, persiste y emite `identity:status-changed` con `{from, to, reason?}` | `UserNotFoundError`, `InvalidStatusTransitionError` |
| `updateDisplayName(userId, displayName)` | usuario existe; displayName válido | Actualiza, persiste y emite `identity:profile-updated` | `UserNotFoundError`, `InvalidDisplayNameError` |
| `changeAccountType(userId, to)` | usuario existe; conversión permitida | Convierte, persiste y emite `identity:type-changed` | `UserNotFoundError`, `InvalidAccountTypeConversionError` |
| `getUser` / `getByUsername` / `listUsers` | módulo inicializado | Consultas de solo lectura; `null` cuando no existe | `Error('Not Initialized')` |

Orden de operaciones en cada comando: validación de dominio → persistencia →
evento. Los comandos devuelven el `UserSnapshot` resultante.

## 2. Dominio

### `User` (agregado)

```ts
export class User {
  readonly id: string
  get username(): string          // normalizado
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
  markEmailVerified(): void                    // reservado para Iteración 5
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
| `PENDING_VERIFICATION` | `ACTIVE`, `SUSPENDED`, `DEACTIVATED`, `BANNED` | → `ACTIVE` debe dispararlo `confirmEmail` (Iteración 5) |
| `ACTIVE` | `SUSPENDED`, `DEACTIVATED`, `BANNED` | — |
| `SUSPENDED` | `ACTIVE`, `DEACTIVATED`, `BANNED` | → `ACTIVE` solo por comando explícito (admin); nunca automático ni por verificación de email |
| `DEACTIVATED` | `ACTIVE`, `BANNED` | → `ACTIVE` requerirá re-auth en Fase 4 |
| `BANNED` | *(terminal)* | unban futuro exigiría ADR + Audit (ADR-0005) |

Transición al mismo estado: rechazada. Helpers públicos: `canTransition`,
`assertTransition`, `STATUS_TRANSITIONS`.

### `AccountType` y política de conversión

```ts
export const AccountType = { Personal, Creator, Official, Government } as const
```

| Desde | Hacia permitido |
|---|---|
| `PERSONAL` | `CREATOR` |
| `CREATOR` | `PERSONAL` |
| `OFFICIAL` / `GOVERNMENT` | *(bloqueado hasta el flujo de verificación correspondiente)* |

### Políticas de perfil

- **username**: trim + lowercase; alfanumérico estricto `[a-z0-9]`; 3–32
  caracteres; unicidad global case-insensitive. (`USERNAME_LIMITS`,
  `normalizeUsername`, `validateUsername`)
- **displayName**: Unicode completo; 1–100 code points; trim.
  (`DISPLAY_NAME_LIMITS`, `validateDisplayName`)

### Tipos de soporte

```ts
export interface VerificationFlags { readonly emailVerified: boolean }

export interface UserRecord extends PersistedRecord {
  readonly username: string
  readonly displayName: string
  readonly accountType: AccountType
  readonly accountStatus: AccountStatus
  readonly verificationFlags: VerificationFlags
  readonly createdAt: number
  readonly updatedAt: number
}

export interface UserSnapshot { /* mismos campos que UserRecord */ }
export interface RegisterUserInput { username; displayName; accountType? }
```

## 3. Eventos emitidos (ADR-0001, prefijo `identity:`)

Todos con `category: 'domain'`, `source: { moduleId: 'identity', entity: 'user', entityId }`, v1.

| Evento | Cuándo | Payload |
|---|---|---|
| `identity:registered` | tras crear usuario + índice | `{ userId, username, accountType, accountStatus }` |
| `identity:status-changed` | tras transición válida | `{ userId, from, to, reason? }` |
| `identity:profile-updated` | tras actualizar displayName | `{ userId, displayName }` |
| `identity:type-changed` | tras conversión de tipo válida | `{ userId, from, to }` |

El módulo registra estos eventos en `CoreEventMap` por *module augmentation*
(`IdentityEventMap.ts`, exportado desde el índice público).

## 4. Persistencia

| Namespace | Record | Contenido |
|---|---|---|
| `identity:users` | `UserRecord` | agregados de usuario |
| `identity:usernames` | `{ id: usernameNormalizado, userId }` | índice de unicidad O(1) |

Escritura de registro: primero el usuario, después el índice (un fallo entre
ambos deja un usuario sin índice — recuperable por reconstrucción; el orden
inverso dejaría un índice colgado, peor). Identidad estable entre sesiones
(hereda las garantías del puerto Persistence).

## 5. Permisos y configuración

- No solicita permisos del puerto `Permissions`.
- No lee claves de `CoreConfig`.

## 6. Deuda conocida

- **Verificación por email** (tokens single-use con expiración e invalidación
  de anteriores, `confirmEmail` → `ACTIVE`): Iteración 5. `markEmailVerified`
  ya está reservado en el agregado.
- **Re-auth para cambios sensibles** (Baseline): llegará con Authentication
  (Fase 4); los comandos sensibles incorporarán entonces el contexto de actor.
- Conversiones a `OFFICIAL`/`GOVERNMENT` bloqueadas hasta definir su flujo de
  verificación.
- `BANNED` terminal: el unban se definirá por ADR junto al Audit Trail (Fase 8).
