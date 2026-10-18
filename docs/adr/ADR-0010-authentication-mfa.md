# ADR-0010 — Authentication 6d: MFA (TOTP) y login en dos pasos

- Status: **Accepted**
- Date: Octubre 2026
- Deciders: Osvaldo Peralta (+ asistencia de IA)
- Relacionados: Baseline v1.0 §2 (*MFA*), ADR-0007/0008/0009, roadmap Fase 4
  (**este ADR cierra la Fase 4**: las 7 responsabilidades de la Baseline §2
  quedan implementadas)

## Contexto

La Baseline §2 lista MFA como responsabilidad de Authentication. Con
credenciales (6a), sesiones (6b) y refresh/reset (6c) en su lugar, falta el
segundo factor. Estándar elegido: **TOTP (RFC 6238)** — compatible con
Google Authenticator, Authy, 1Password, etc., sin dependencia de SMS
(vector de SIM-swapping) ni de proveedores externos.

## Decisión

### 1. `TotpService`: RFC 6238 puro, zero-deps, reloj inyectable

- HMAC-SHA1 vía `crypto.subtle` (mismo stack isomórfico que PBKDF2).
- Defaults de apps authenticator: período 30 s, 6 dígitos, secret 160 bits
  base32 (RFC 4648, utilidad propia), ventana de verificación ±1 paso.
- **Reloj inyectable** (`now`): tests deterministas validados contra los
  **vectores oficiales de RFC 6238** (modo digits=8).
- Comparación de códigos constant-time.
- `generateTotpUri` produce la URI `otpauth://` (issuer `MorningStar`); el
  render del QR es responsabilidad del cliente (sin dependencias servidoras).

### 2. Enrolamiento en dos pasos (estándar)

`enrollMfa` (secret PENDING, se muestra una vez) → `confirmMfa(code)`
(prueba de posesión → ACTIVE + 10 backup codes entregados una vez).
Re-enrolamiento con MFA activo exige `disableMfa` previo
(`MfaAlreadyActiveError`); `disableMfa` exige factor válido (TOTP o backup).

### 3. Secret TOTP en claro + deuda explícita (decisión del owner)

A diferencia de passwords/tokens (one-way), el servidor NECESITA el secret
para recalcular códigos: es reversible por naturaleza. Sin backend no existe
gestión de claves real, y cifrar con una clave hardcodeada sería teatro de
seguridad. Decisión: almacenar en claro en `auth:mfa` con **deuda registrada**:
el backend de producción debe cifrarlo en reposo (KMS / env-secret) — se
verificará en la Fase 8 (seguridad avanzada). Los backup codes SÍ se
almacenan one-way (SHA-256), como las contraseñas.

### 4. Login en dos pasos con challenge (compatible con 6b/6c)

Con MFA activo, `login` valida la contraseña y **lanza `MfaRequiredError`
que porta un `mfaToken`** (decisión del owner sobre unión discriminada):
`login(): Promise<LoginResult>` no cambia de forma.

El challenge (`auth:mfa-challenges`, `id` = SHA-256 del mfaToken):
- 256 bits opaco, **TTL 5 min**, **single-use**, guarda el
  `deviceFingerprint` del intento (no se pide de nuevo en el segundo paso).
- **Máx. 5 intentos de código** por challenge (al agotarse, muere): cota
  anti-fuerza-bruta del espacio de 6 dígitos sin tocar el lockout de
  contraseña (contadores separados).
- `completeMfaLogin(mfaToken, code)` acepta TOTP o backup code; revalida
  cuenta ACTIVE; emite el par sesión+refresh vía el mismo `issueSession`
  de 6b/6c.

### 5. Anti-replay TOTP

El record guarda `lastAcceptedStep`; un código cuyo step no sea estrictamente
posterior al último aceptado se rechaza, aunque esté dentro de la ventana ±1.
(El estándar: cada código TOTP se usa una sola vez.)

### 6. Backup codes

10 códigos `XXXXX-XXXXX` (alfabeto sin caracteres ambiguos 0/O/1/I),
persistidos solo como SHA-256, consumo individual. Cubren pérdida del
dispositivo sin romper el modelo de amenazas (un backup code es un segundo
factor de posesión). Sin regeneración automática todavía (deuda: el usuario
puede re-enrolar vía disable+enroll).

### 7. MFA no afecta a refresh

Un refresh token fue emitido tras autenticación completa (password + MFA):
`refresh` no vuelve a pedir segundo factor. MFA aplica a `login` nuevos.

### 8. Eventos (v1)

`auth:mfa-enrollment-started`, `auth:mfa-activated`, `auth:mfa-disabled`,
`auth:login-mfa-required` (todos `{userId}`); `LoginFailedPayload.reason`
gana `'invalid-mfa-code'` (aditivo). Ningún evento incluye secrets ni códigos.

## Consecuencias

**Positivas**
- Fase 4 completa y verificable: las 7 responsabilidades de Baseline §2
  implementadas con tests (241 en la suite).
- TOTP validado contra vectores RFC: interoperable con cualquier app
  authenticator desde el día uno.
- Challenge flow compatible hacia atrás: ningún consumidor de 6b/6c se rompe.

**Costos / deudas**
- Secret TOTP en claro hasta backend con KMS (deuda explícita, Fase 8).
- Sin rate-limiting por IP en `completeMfaLogin` (la cota por challenge
  mitiga; el resto llega con backend + Risk Engine).
- Sin regeneración de backup codes ni notificación "nuevo factor activado"
  por email (deuda registrada en el contrato).
- QR rendering queda del lado cliente (UI de login, próxima candidata).
