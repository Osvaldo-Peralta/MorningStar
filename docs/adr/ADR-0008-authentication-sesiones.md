# ADR-0008 — Authentication 6b: sesiones opacas, logout y fingerprinting

- Status: **Accepted**
- Date: Octubre 2026
- Deciders: Osvaldo Peralta (+ asistencia de IA)
- Relacionados: Baseline v1.0 §2 (Session Model, mass invalidation), ADR-0006 (patrón hash-de-token), ADR-0007 (credenciales), roadmap Fase 4

## Contexto

La Baseline §2 define el modelo de sesión (`userId`, `deviceFingerprint`,
`issuedAt`, `expiresAt`, `riskSnapshot`) y exige *mass invalidation under
ACTIVE_DEFENSE*. Con credenciales y login resueltos (6a), falta el corazón de
la autenticación persistente: emisión, validación y revocación de sesiones.

## Decisión

### 1. Tokens opacos + almacén server-side (NO JWT)

- **Revocación inmediata**: requisito literal de la Baseline (invalidación
  masiva). Un JWT firmado es irrevocable hasta su expiración sin una denylist
  central… que es funcionalmente un almacén de sesiones, con complejidad extra.
- Cero gestión de secretos de firma y cero superficie de *algorithm
  confusion* / ataques a JWT.
- Cuando existan servicios distribuidos que necesiten validar sin round-trip
  al almacén, se reevaluará (el contrato `validateSession` no cambia).

### 2. El token nunca se persiste: hash SHA-256 como identidad

Mismo patrón que los tokens de email (ADR-0006): token opaco de 256 bits
(base64url), `SessionRecord.id = SHA-256(token)`. El claro se entrega **una
sola vez** en el `LoginResult`. Una fuga del almacén no permite secuestrar
sesiones. `sessionId` (el hash) es seguro de exponer en UIs/eventos.

### 3. Ciclo de vida

- **TTL fijo 60 min** por defecto (`SESSION_DEFAULTS.accessTokenTtlMs`),
  inyectable por instancia (tests, futuras políticas por tipo de cuenta).
- **Expiración lazy**: `validateSession` rechaza sin escribir; el GC de
  registros expirados es deuda (como tokens de email).
- `lastSeenAt` se actualiza en cada validación (audit y UX de dispositivos).
- Sin sliding expiration todavía: la renovación basada en riesgo es tema del
  Risk Engine (Fase 8) y los refresh tokens (6c) resuelven la UX.

### 4. Revocación en tres niveles

| Nivel | API | Evento |
|---|---|---|
| Sesión | `logout(token)` → boolean | `auth:session-revoked` (`reason: 'logout'`) |
| Usuario | `logoutUser(userId)` → count | `auth:session-revoked` por sesión (`reason: 'logout-all'`) |
| Global (ACTIVE_DEFENSE) | `invalidateAllSessions(reason)` → count | `auth:sessions-invalidated` agregado (uno solo: puede ser masivo) |

Revocada = `revokedAt` + `revokedReason` en el record (append-style: se
conserva para audit, no se borra).

### 5. `riskSnapshot` forward-compatible

Campo de la Baseline implementado hoy como `{ riskLevel: 'UNKNOWN' }`
(tipo `RiskLevel = 'UNKNOWN' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'`,
coincide con la Baseline §4). El Risk Engine (Fase 8) lo poblará sin cambio
de esquema; `validateSession` ya lo expone.

### 6. Device fingerprinting: capturado, no calculado

`login(identifier, password, device?: { fingerprint })` — el fingerprint lo
aporta el cliente (la web calculará el suyo cuando exista la UI de login;
Node/backend usará el del user-agent o SDK). Sin device: `'unknown'`. El
módulo lo persiste, lo expone en `listSessions` (UX "tus dispositivos") y en
eventos. Calcular fingerprints robustos es responsabilidad de cada cliente;
el Risk Engine (Fase 8) definirá el DeviceTrust lifecycle (Baseline §4).

### 7. Extensión aditiva del contrato 6a

`LoginResult` pasa de `{ userId }` a `{ userId, session: SessionInfo & { token } }`
— aditivo (promesa de ADR-0007 §8). `login` gana el parámetro opcional
`device`. `SessionInfo` (modelo público) nunca incluye el token.

### 8. Utilidades criptográficas duplicadas (regla de tres)

`generateOpaqueToken`/`hashOpaqueToken` duplican los utils de tokens de
identity (feature ↔ feature prohibido). Si un tercer módulo necesita lo
mismo, se extraen a `@morningstar/core` como utilidad pública.

## Consecuencias

**Positivas**
- Invalidación masiva real e inmediata (ACTIVE_DEFENSE tiene primitiva).
- Tokens inutilizables si el almacén se filtra.
- `listSessions` habilita la UX de dispositivos activos y el futuro DeviceTrust.

**Costos / deudas**
- Cada validación hace I/O al almacén (trade-off de opacos vs JWT; aceptable
  con adapters locales, se optimizará con cache en el backend).
- GC de sesiones expiradas/revocadas pendiente.
- Refresh tokens (6c) evitarán re-login cada 60 min.
