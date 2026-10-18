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
  //            lockout?: { maxFailedAttempts?, durationMs? },
  //            session?: { accessTokenTtlMs? } }        ← default 60 min (ADR-0008)

  setPassword(userId: string, password: string): Promise<void>
  changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>
  login(identifier: string, password: string, device?: DeviceInfo): Promise<LoginResult>
  refresh(refreshToken: string): Promise<LoginResult>
  requestPasswordReset(identifier: string): Promise<void>
  resetPassword(token: string, newPassword: string): Promise<void>
  validateSession(token: string): Promise<SessionInfo | null>
  logout(token: string): Promise<boolean>
  logoutUser(userId: string): Promise<number>
  invalidateAllSessions(reason: string): Promise<number>
  listSessions(userId: string): Promise<SessionInfo[]>
}
```

`LoginResult` (6b/6c, aditivo sobre 6a):

```ts
export interface LoginResult {
  readonly userId: string
  readonly session: SessionInfo & { readonly token: string }  // token: una sola entrega
  readonly refreshToken: string                               // una sola entrega; rota en cada refresh
}
```

**`init(context)` requiere `context.persistence`** (camino único, ADR-0003).

| Método | Precondiciones | Comportamiento | Errores |
|---|---|---|---|
| `setPassword` | password cumple política | Comando de sistema (alta inicial / reset admin): hashea y persiste credenciales; emite `auth:password-set` | `InvalidPasswordError`, `Error('Not Initialized')` |
| `changePassword` | credenciales existen; `currentPassword` correcta; nueva cumple política | Rota el hash, resetea contadores, **revoca todas las sesiones** (`password-changed`); emite `auth:password-changed` con `sessionsRevoked` | `MissingCredentialsError`, `InvalidCredentialsError`, `InvalidPasswordError` |
| `login(identifier, password, device?)` | identifier = username o email (resueltos por el directorio); cuenta `ACTIVE` | Orden: directorio → credenciales → lockout → contraseña → estado → **emisión de sesión**. Éxito: resetea contadores, emite `auth:login-succeeded` + `auth:session-issued`, devuelve `{ userId, session: SessionInfo & { token } }` (el token se entrega una sola vez) | `InvalidCredentialsError` (genérico anti-enumeración), `AccountLockedError`, `AccountNotActiveError` |
| `validateSession(token)` | módulo inicializado | Devuelve `SessionInfo` si la sesión es válida; `null` si desconocida/expirada/revocada (no revela cuál). Actualiza `lastSeenAt` | `Error('Not Initialized')` |
| `logout(token)` | — | Revoca la sesión (`reason: 'logout'`); `false` si no existe o ya estaba revocada | — |
| `logoutUser(userId)` | — | Revoca todas las sesiones activas del usuario (`reason: 'logout-all'`); devuelve el conteo | — |
| `invalidateAllSessions(reason)` | — | **Primitiva ACTIVE_DEFENSE** (Baseline §2): revoca todas las sesiones activas del sistema; devuelve el conteo; emite un único evento agregado | — |
| `listSessions(userId)` | módulo inicializado | Sesiones activas del usuario (UX "tus dispositivos"); nunca expone tokens | — |
| `refresh(refreshToken)` | RT válido (no consumido/revocado/expirado); sesión asociada no revocada; cuenta `ACTIVE` | **Rotación completa** (ADR-0009): par nuevo (sesión + RT), sesión anterior revocada (`rotated`), RT anterior consumido con lineage; emite `auth:token-refreshed` + `auth:session-issued` | `InvalidRefreshTokenError`, `RefreshTokenReuseError` (robo: revoca la sesión actual de la familia + emite `auth:refresh-reuse-detected`), `AccountNotActiveError` |
| `requestPasswordReset(identifier)` | `context.email` presente | **Anti-enumeración**: misma respuesta exista o no la cuenta. Si existe: invalida tokens anteriores, genera token (TTL 1 h), envía email, emite `auth:password-reset-requested` | `Error("...requiere 'context.email'...")` |
| `resetPassword(token, newPassword)` | token válido (no consumido/invalidado/expirado); nueva contraseña cumple política | Consume el token (single-use), rota el hash, **revoca todas las sesiones** (`password-reset`); emite `auth:password-reset` | `InvalidResetTokenError`, `ResetTokenInvalidatedError`, `ResetTokenAlreadyUsedError`, `ResetTokenExpiredError`, `InvalidPasswordError` |

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

Garantías de sesiones (ADR-0008):
- Token **opaco** de 256 bits; se persiste solo su SHA-256 (`SessionRecord.id`);
  el claro se entrega una única vez en el login.
- TTL fijo 60 min por defecto (`SESSION_DEFAULTS.accessTokenTtlMs`),
  inyectable; expiración lazy en `validateSession`.
- Revocación inmediata en tres niveles: sesión / usuario / global. Motivos
  (`SessionRevokedReason`): `logout`, `logout-all`, `mass-invalidation`,
  `rotated`, `reuse-detected`, `password-changed`, `password-reset`.
- **Refresh con rotación completa** (ADR-0009): TTL 30 días por defecto
  (`SESSION_DEFAULTS.refreshTokenTtlMs`); reuso detectado ⇒ revocación de la
  sesión actual de la familia + evento de seguridad.
- Reset de contraseña: tokens de 1 h (`PASSWORD_RESET_DEFAULTS.tokenTtlMs`),
  single-use, invalidación de anteriores, anti-enumeración.
- `riskSnapshot` nace en `{ riskLevel: 'UNKNOWN' }`; el Risk Engine (Fase 8)
  lo poblará sin cambio de esquema.
- `device.fingerprint` lo aporta el cliente (default `'unknown'`).

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
export interface UserDirectoryEntry {
  readonly userId: string
  readonly accountStatus: LoginRelevantAccountStatus
  readonly email: string   // contacto para flujos de seguridad (6c)
}

export interface UserDirectoryPort {
  lookupUser(identifier: string): Promise<UserDirectoryEntry | null>
  getUserAccount(userId: string): Promise<UserDirectoryEntry | null>  // refresh y reset (ADR-0009)
}
```

La composición lo cablea con identity (ejemplo en `bootstrap.ts`):
`getByUsername(identifier) ?? getByEmail(identifier)` y `getUser(userId)`.

## 3. Eventos emitidos (ADR-0001, prefijo `auth:`)

Todos con `category: 'domain'`, `source: { moduleId: 'authentication', entity: 'credentials' | 'session', entityId? }`, v1.

| Evento | Cuándo | Payload |
|---|---|---|
| `auth:password-set` | tras `setPassword` | `{ userId }` |
| `auth:password-changed` | tras `changePassword` exitoso | `{ userId }` |
| `auth:login-succeeded` | login válido + cuenta ACTIVE | `{ userId }` |
| `auth:login-failed` | cualquier rechazo | `{ userId?, reason: 'invalid-credentials' \| 'locked' \| 'account-not-active', failedAttempts?, accountStatus? }` — sin userId ni identifier cuando el usuario no existe |
| `auth:account-locked` | al alcanzarse el umbral de fallos | `{ userId, lockedUntil }` |
| `auth:session-issued` | tras emitir sesión en login **y en refresh** | `{ userId, sessionId, deviceFingerprint, expiresAt }` |
| `auth:session-revoked` | por `logout` / `logoutUser` / rotación / reuso / cambio de contraseña | `{ sessionId, userId?, reason }` |
| `auth:sessions-invalidated` | por `invalidateAllSessions` (uno agregado, no por sesión) | `{ count, reason }` |
| `auth:token-refreshed` | tras rotación exitosa en `refresh` | `{ userId, sessionId }` (sesión nueva) |
| `auth:refresh-reuse-detected` | al presentarse un RT consumido (posible robo) | `{ userId, sessionId }` (sesión revocada defensivamente) |
| `auth:password-reset-requested` | tras `requestPasswordReset` | `{ userId? }` — ausente si el identifier no existe |
| `auth:password-reset` | tras `resetPassword` exitoso | `{ userId, sessionsRevoked }` |

Ningún payload incluye tokens ni contraseñas.

## 4. Persistencia

| Namespace | Record | Contenido |
|---|---|---|
| `auth:credentials` | `CredentialRecord` (`id` = userId) | `{ passwordHash, failedAttempts, lockedUntil?, createdAt, updatedAt }` |
| `auth:sessions` | `SessionRecord` (`id` = SHA-256 del token) | `{ userId, deviceFingerprint, issuedAt, expiresAt, lastSeenAt, riskSnapshot, revokedAt?, revokedReason? }` |
| `auth:refresh-tokens` | `RefreshTokenRecord` (`id` = SHA-256 del RT) | `{ userId, sessionId, issuedAt, expiresAt, consumedAt?, rotatedToHash?, revokedAt?, revokedReason? }` |
| `auth:password-reset-tokens` | `PasswordResetTokenRecord` (`id` = SHA-256 del token) | `{ userId, createdAt, expiresAt, consumedAt?, invalidatedAt? }` |

Solo hashes auto-descriptivos y de tokens; contadores de lockout y sesiones
revocadas persistidos (sobreviven reinicios; las revocaciones se conservan
para audit, no se borran).

## 5. Permisos y configuración

- No usa el puerto `Permissions`.
- Configuración por instancia: `passwordPolicy` (default 8..128) y `lockout`
  (default 5 / 15 min). No lee `CoreConfig`.

## 6. Deuda conocida

- **MFA (TOTP)**: Iteración 6d — cierra la Fase 4.
- Sin rate-limiting por IP/dispositivo en login y `requestPasswordReset`
  (llegará con backend + Risk Engine).
- Sin complejidad de contraseña ni detección de credenciales filtradas.
- Re-hash automático al migrar de algoritmo (gancho previsto en el formato,
  implementación cuando exista Argon2id en backend).
- GC de sesiones expiradas/revocadas, RT consumidos y tokens de email/reset
  pendientes (un único job futuro).
- Sin email de notificación "tu contraseña cambió" (llegará con proveedor real).
- Cambio de email con re-verificación: deuda de identity.
- UI de login en la web: propuesta al cerrar la Fase 4 (6d).
