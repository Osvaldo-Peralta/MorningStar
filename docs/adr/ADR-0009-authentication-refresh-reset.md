# ADR-0009 — Authentication 6c: refresh tokens y reset de contraseña

- Status: **Accepted**
- Date: Octubre 2026
- Deciders: Osvaldo Peralta (+ asistencia de IA)
- Relacionados: Baseline v1.0 §2, ADR-0006 (patrón hash-de-token), ADR-0007 (credenciales), ADR-0008 (sesiones), roadmap Fase 4

## Contexto

Con sesiones de 60 min (6b), sin refresh el usuario se desloguearía cada hora.
La Baseline §2 lista *Refresh Tokens* y *Reset Password* como
responsabilidades de Authentication. Esta iteración cierra ambos; MFA (6d)
cerrará la Fase 4.

## Decisión

### 1. Refresh con rotación completa del par

`refresh(refreshToken)` emite **sesión nueva + RT nuevo** y retira los
anteriores (sesión vieja revocada con `reason: 'rotated'`; RT viejo marcado
`consumedAt` + `rotatedToHash` como lineage). Alternativa descartada: extender
`expiresAt` de la misma sesión — mantiene vivo un access token viejo,
agrandando la ventana de un token robado (decisión del owner).

- RT: 256 bits, persistido solo como SHA-256 en `auth:refresh-tokens`
  (tercera aplicación del patrón ADR-0006: email tokens, sesiones, refresh).
- TTL 30 días por defecto (`SESSION_DEFAULTS.refreshTokenTtlMs`), inyectable.
- `refresh` revalida: RT íntegro, sesión asociada no revocada (expirada está
  bien — es el propósito), y **cuenta ACTIVE** (suspendida/baneada pierde
  acceso en el próximo refresh, sin esperar el TTL del access).

### 2. Detección de reuso con revocación de familia (OAuth BCP)

Presentar un RT ya consumido es la señal canónica de robo (atacante y víctima
poseen copias del mismo token). Respuesta:

1. Seguir el lineage `rotatedToHash` hasta el descendiente más reciente.
2. Revocar SU sesión activa (`reason: 'reuse-detected'`).
3. Emitir `auth:refresh-reuse-detected` (señal para el Audit Trail, Fase 8).
4. Lanzar `RefreshTokenReuseError`.

Trade-off aceptado: un cliente desincronizado (retry duplicado) provoca un
logout defensivo; es el comportamiento estándar recomendado (RFC 6819 /
OAuth Security BCP).

### 3. Reset de contraseña self-service

Mismo ciclo de vida que los tokens de verificación (ADR-0006): generated per
request, single-use, TTL **1 hora** (`PASSWORD_RESET_DEFAULTS`, inyectable),
invalidates previous active tokens. Namespace `auth:password-reset-tokens`,
`id = SHA-256(token)`; el claro solo viaja en el email (`EmailDelivery`).

- **Anti-enumeración**: `requestPasswordReset(identifier)` devuelve `void`
  exista o no la cuenta; el evento `auth:password-reset-requested` lleva
  `userId` solo cuando existe; se genera y hashea un token en ambos caminos
  para igualar trabajo criptográfico (mitigación parcial de timing; el envío
  de email solo ocurre si existe — diferencia aceptada y documentada).
- **Política antes de consumir**: una contraseña nueva inválida no quema el
  token (UX); el consumo ocurre antes de los efectos de dominio (single-use
  estricto).
- `resetPassword` **revoca todas las sesiones** del usuario
  (`reason: 'password-reset'`): si llegó aquí, hubo un email comprometido o
  un usuario olvidadizo; en ambos casos las sesiones vigentes no son de
  confianza.

### 4. `changePassword` también revoca sesiones

Cambio de comportamiento sobre 6a (módulo Experimental, permitido): toda
rotación de contraseña —voluntaria o por reset— invalida las sesiones
activas (`reason: 'password-changed'`). Los RT quedan inofensivos sin
necesidad de tocarlos: `refresh` valida la sesión y está revocada.

### 5. `UserDirectoryPort` extendido

```ts
interface UserDirectoryEntry { userId; accountStatus; email }   // + email
interface UserDirectoryPort {
  lookupUser(identifier): Promise<UserDirectoryEntry | null>
  getUserAccount(userId): Promise<UserDirectoryEntry | null>     // nuevo (6c)
}
```

`getUserAccount` sirve a `refresh` (revalidar estado) y
`requestPasswordReset` (destino del email). El adaptador de composición lo
resuelve con `IdentityModule.getUser`.

### 6. `SessionRevokedReason` extendido (aditivo)

`'rotated' | 'reuse-detected' | 'password-changed' | 'password-reset'` se
suman a `'logout' | 'logout-all' | 'mass-invalidation'`. Los consumidores
deben tolerar valores nuevos (espíritu ADR-0001 §3).

### 7. Eventos nuevos (v1)

`auth:token-refreshed` `{userId, sessionId}` · `auth:refresh-reuse-detected`
`{userId, sessionId}` · `auth:password-reset-requested` `{userId?}` ·
`auth:password-reset` `{userId, sessionsRevoked}` · `auth:password-changed`
gana `sessionsRevoked?` (aditivo). Ninguno incluye tokens.

## Consecuencias

**Positivas**
- Sesiones cortas sin fricción (refresh transparente) con superficie de robo
  mínima (rotación + detección de reuso + revocación de familia).
- Reset self-service completo y anti-enumeración.
- ACTIVE_DEFENSE reforzado: la invalidación masiva ya no puede "resucitarse"
  vía refresh (las sesiones revocadas bloquean el refresh).

**Costos / deudas**
- Retry duplicado de refresh ⇒ logout defensivo (trade-off estándar).
- GC de RT consumidos/expirados y de tokens de reset pendiente (mismo bucket
  que sesiones y tokens de email).
- Sin rate-limiting por IP en `requestPasswordReset` (backend + Risk Engine).
- Sin email de notificación "tu contraseña cambió" (deuda registrada; llegará
  con el proveedor de email real).
- Cambio de email con re-verificación sigue fuera (deuda de identity).
