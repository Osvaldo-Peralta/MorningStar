# Contrato — `@morningstar/authentication`

- Estabilidad: **Experimental** (promoverá a Stable al cerrar la Fase 4 con
  las Iteraciones 6b/6c)
- Versión del paquete: 0.1.0
- Dueño de prefijos de eventos: `auth:`
- Dependencias: `@morningstar/core` (única — ADR-0002); `identity` NO se
  importa: se integra vía `UserDirectoryPort` inyectado (ADR-0007)

Credenciales, hashing de contraseñas y login (Baseline v1.0 §2, Fase 4 —
Iteración 6a). Sesiones/refresh/fingerprinting (6b) y reset por email/MFA (6c)
llegarán en iteraciones posteriores. Decisiones en ADR-0007.

---

## 1. API pública — `AuthenticationModule`

```ts
export class AuthenticationModule implements AppModule {
  readonly id = 'authentication'
  readonly version: string
  state: ModuleState

  constructor(options: AuthenticationModuleOptions)
  // options: { passwordHasher: PasswordHasher,          ← obligatorio
  //            userDirectory: UserDirectoryPort,        ← obligatorio
  //            passwordPolicy?: { minLength?, maxLength? },
  //            lockout?: { maxFailedAttempts?, durationMs? } }

  setPassword(userId: string, password: string): Promise<void>
  changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>
  login(identifier: string, password: string): Promise<LoginResult>   // { userId }
}
```

**`init(context)` requiere `context.persistence`** (camino único, ADR-0003).

| Método | Precondiciones | Comportamiento | Errores |
|---|---|---|---|
| `setPassword` | password cumple política | Comando de sistema (alta inicial / reset admin): hashea y persiste credenciales; emite `auth:password-set` | `InvalidPasswordError`, `Error('Not Initialized')` |
| `changePassword` | credenciales existen; `currentPassword` correcta; nueva cumple política | Rota el hash, resetea contadores de fallo; emite `auth:password-changed` | `MissingCredentialsError`, `InvalidCredentialsError`, `InvalidPasswordError` |
| `login(identifier, password)` | identifier = username o email (resueltos por el directorio); cuenta `ACTIVE` | Orden: directorio → credenciales → lockout → contraseña → estado. Éxito: resetea contadores, emite `auth:login-succeeded`, devuelve `{ userId }` | `InvalidCredentialsError` (genérico anti-enumeración), `AccountLockedError`, `AccountNotActiveError` |

Garantías de seguridad (ADR-0007):
- **Anti-enumeración**: usuario inexistente / sin credenciales / contraseña
  incorrecta ⇒ idéntico `InvalidCredentialsError`; costo criptográfico
  igualado con hash dummy.
- El estado de cuenta solo se revela tras validar la contraseña.
- **Lockout**: `LOCKOUT_DEFAULTS = { maxFailedAttempts: 5, durationMs: 900_000 }`
  (15 min), configurable; el fallo que alcanza el umbral lanza
  `AccountLockedError` y emite `auth:account-locked`; el éxito resetea.
- Solo `ACTIVE` puede loguearse.
- La contraseña en claro nunca se persiste, emite ni loguea.

## 2. Puertos del módulo (inyectados por constructor)

### `PasswordHasher`

```ts
export interface PasswordHasher {
  hash(password: string): Promise<string>                  // formato auto-descriptivo
  verify(password: string, hash: string): Promise<boolean>  // constant-time; false ante hash corrupto
}
```

Adaptador incluido — `Pbkdf2PasswordHasher` (WebCrypto, zero-deps):
formato `pbkdf2-sha256$<iterations>$<salt-b64url>$<digest-b64url>`;
`PBKDF2_DEFAULT_ITERATIONS = 600_000` (OWASP); opciones
`{ iterations, saltBytes, keyLengthBytes }`. Crypto-agile: las iteraciones
viajan en el hash; migración futura a Argon2id por re-hash en login exitoso.

### `UserDirectoryPort`

```ts
export type LoginRelevantAccountStatus =
  'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | 'BANNED'

export interface UserDirectoryEntry { userId: string; accountStatus: LoginRelevantAccountStatus }

export interface UserDirectoryPort {
  lookupUser(identifier: string): Promise<UserDirectoryEntry | null>
}
```

La composición lo cablea con identity (ejemplo en `bootstrap.ts`):
`getByUsername(identifier) ?? getByEmail(identifier)`.

## 3. Eventos emitidos (ADR-0001, prefijo `auth:`)

Todos con `category: 'domain'`, `source: { moduleId: 'authentication', entity: 'credentials' | 'session', entityId? }`, v1.

| Evento | Cuándo | Payload |
|---|---|---|
| `auth:password-set` | tras `setPassword` | `{ userId }` |
| `auth:password-changed` | tras `changePassword` exitoso | `{ userId }` |
| `auth:login-succeeded` | login válido + cuenta ACTIVE | `{ userId }` |
| `auth:login-failed` | cualquier rechazo | `{ userId?, reason: 'invalid-credentials' \| 'locked' \| 'account-not-active', failedAttempts?, accountStatus? }` — sin userId ni identifier cuando el usuario no existe |
| `auth:account-locked` | al alcanzarse el umbral de fallos | `{ userId, lockedUntil }` |

## 4. Persistencia

| Namespace | Record | Contenido |
|---|---|---|
| `auth:credentials` | `CredentialRecord` (`id` = userId) | `{ passwordHash, failedAttempts, lockedUntil?, createdAt, updatedAt }` |

Solo hashes auto-descriptivos; contadores de lockout persistidos (sobreviven
reinicios).

## 5. Permisos y configuración

- No usa el puerto `Permissions`.
- Configuración por instancia: `passwordPolicy` (default 8..128) y `lockout`
  (default 5 / 15 min). No lee `CoreConfig`.

## 6. Deuda conocida

- **Logout/sesiones**: sin sesiones no hay logout real — Iteración 6b
  (`LoginResult` se ampliará de forma aditiva con la `Session` de la
  Baseline §2).
- Reset de contraseña self-service por email y MFA: Iteración 6c.
- Sin rate-limiting por IP/dispositivo (llegará con backend + Risk Engine).
- Sin complejidad de contraseña ni detección de credenciales filtradas.
- Re-hash automático al migrar de algoritmo (gancho previsto en el formato,
  implementación cuando exista Argon2id en backend).
