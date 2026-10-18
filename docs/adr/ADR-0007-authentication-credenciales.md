# ADR-0007 — Authentication 6a: credenciales, hashing y login

- Status: **Accepted**
- Date: Octubre 2026
- Deciders: Osvaldo Peralta (+ asistencia de IA)
- Relacionados: Baseline v1.0 §2, ADR-0002 (dependencias), ADR-0005/0006 (Identity), roadmap Fase 4

## Contexto

La Fase 4 (Authentication) es la más grande del roadmap: login/logout,
sesiones, refresh tokens, change/reset password, MFA, session issuance,
device fingerprinting e invalidación masiva bajo ACTIVE_DEFENSE. Se parte en
tres iteraciones:

- **6a (este ADR): credenciales + hashing + login/logout lógico.**
- 6b: sesiones, refresh tokens, device fingerprinting, invalidación masiva.
- 6c: reset de contraseña por email (reutiliza `EmailDelivery`) y MFA.

Nota documental: RFC-0001 resultó ser solo front-matter (sin cuerpo); la
referencia de seguridad efectiva es la Baseline v1.0 + esta serie de ADRs.

## Decisión

### 1. Paquete `@morningstar/authentication` (feature → core)

Depende solo de `core`. **No importa `identity`** (feature ↔ feature prohibido,
ADR-0002): la resolución identificador → usuario se hace por el puerto
`UserDirectoryPort`, inyectado por la composición (bootstrap hoy, backend
mañana) con un adaptador basado en `IdentityModule.getByUsername/getByEmail`.
Los valores de `accountStatus` en el puerto son los strings del contrato de
identity: duplicación deliberada del wire-format para preservar el
desacoplamiento.

Identity recibe a cambio un método aditivo: `getByEmail` (contrato Stable,
cambio aditivo permitido).

### 2. Hashing: PBKDF2-HMAC-SHA256 vía WebCrypto, formato crypto-agile

- **Zero-dependencies e isomórfico** (Node 20+ y navegadores): `crypto.subtle`.
- **600.000 iteraciones** por defecto (OWASP 2023 para PBKDF2-SHA256);
  inyectables por constructor (tests/entornos lentos).
- Formato PHC-like auto-descriptivo:
  `pbkdf2-sha256$<iterations>$<salt-b64url>$<digest-b64url>`.
- **Crypto-agile**: el algoritmo y parámetros viajan en el hash ⇒ migración
  futura a Argon2id (cuando haya backend Node-only y se acepte la dependencia
  nativa) verificando formato viejo y **re-hasheando en el próximo login
  exitoso**, sin invalidar contraseñas. Argon2id hoy rompería la isomorfía
  (node-gyp) — decisión explícita del owner.
- Salt única por hash (16 bytes, `crypto.getRandomValues`); comparación
  **constant-time** del digest.
- `crypto.subtle` en navegador exige contexto seguro (https/localhost): dev
  cumple; producción será https.

### 3. Puerto `PasswordHasher` inyectado por constructor (no por CoreContext)

`CoreContext` permanece genérico: capacidades usadas por un único módulo se
inyectan en sus opciones (`AuthenticationModuleOptions.passwordHasher`,
`.userDirectory`). Precedente: `IdentityModuleOptions.tokenTtlMs`. El puerto
es público: permite auditar/sustituir el algoritmo sin tocar el módulo.

### 4. Anti-enumeración de usuarios

- Usuario inexistente, usuario sin credenciales y contraseña incorrecta
  producen el **mismo** error (`InvalidCredentialsError`, mismo mensaje).
- El costo criptográfico se iguala: ante usuario/credenciales inexistentes se
  ejecuta un `verify` contra un **hash dummy** memoizado.
- Los eventos `auth:login-failed` sin usuario resuelto no incluyen el
  identifier (el bus interno no debe convertirse en registro de emails
  probeables; Audit — Fase 8 — decidirá qué capturar).
- El estado de cuenta (`AccountNotActiveError`) solo se evalúa y revela
  **después** de validar la contraseña: únicamente el dueño legítimo lo ve.

### 5. Lockout anti fuerza-bruta (piso hasta el Risk Engine)

- Defaults: **5 fallos consecutivos → 15 minutos** de bloqueo
  (`LOCKOUT_DEFAULTS`), configurables por instancia.
- El fallo que alcanza el umbral lanza `AccountLockedError` directamente (el
  cliente conoce el bloqueo de inmediato) y emite `auth:account-locked`.
- Login exitoso resetea el contador. Contador y `lockedUntil` viven en
  `auth:credentials` (persistidos: sobreviven reinicios).
- Fase 8 (Risk Engine) lo sofisticará (señales, device trust, escalado);
  este piso no estorba ese diseño.

### 6. Política de login por estado de cuenta

Solo `ACTIVE` puede loguearse. `PENDING_VERIFICATION` ⇒
`AccountNotActiveError('PENDING_VERIFICATION')` (el flujo correcto es
verificar el email primero — Fase 3 ya construida). `SUSPENDED`,
`DEACTIVATED` y `BANNED` ⇒ rechazados con su estado. Decisión explícita del
owner.

### 7. Política de contraseñas (MVP)

Mínimo 8 (NIST 800-63B), máximo 128 (cota anti-DoS del hashing),
configurable por instancia. Sin reglas de complejidad ni listas de filtradas
(deuda: llegarán con el backend o librerías dedicadas). `setPassword` es
comando de sistema (alta inicial / reset administrativo); el flujo de usuario
es `changePassword` (exige la actual); el reset self-service por email es 6c.

### 8. `LoginResult` preparado para 6b

Hoy devuelve `{ userId }`. En 6b se ampliará de forma **aditiva** con la
`Session` de la Baseline §2 (`deviceFingerprint`, `issuedAt`, `expiresAt`,
`riskSnapshot`) y el logout real (invalidación de sesión). El "logout" de 6a
no existe aún porque no hay sesiones: se implementa completo en 6b.

### 9. Eventos `auth:*` (v1)

`auth:password-set`, `auth:password-changed`, `auth:login-succeeded`,
`auth:login-failed` (`{ userId?, reason, failedAttempts?, accountStatus? }`),
`auth:account-locked` (`{ userId, lockedUntil }`). Ningún payload incluye la
contraseña ni el identifier probeado.

## Consecuencias

**Positivas**
- Login seguro y testeado contra los ataques básicos (enumeración, timing,
  fuerza bruta) antes de construir sesiones encima.
- Migración de algoritmo de hash prevista sin rompimientos.
- `auth` e `identity` evolucionan independientes gracias al puerto de
  directorio.

**Costos / deudas**
- PBKDF2 no es el estado del arte absoluto (Argon2id lo es): aceptado por
  isomorfía y zero-deps, con camino de migración definido.
- Sin rate-limiting por IP/dispositivo (no hay transporte HTTP todavía):
  llegará con el backend + Risk Engine.
- Sin complejidad de contraseña ni detección de credenciales filtradas.
