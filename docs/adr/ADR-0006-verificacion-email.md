# ADR-0006 — Verificación de email: tokens, entrega y reglas de estado

- Status: **Accepted**
- Date: Octubre 2026
- Deciders: Osvaldo Peralta (+ asistencia de IA)
- Relacionados: Baseline v1.0 §1 (EmailVerificationToken Lifecycle), ADR-0005 (Identity), roadmap Fase 3

## Contexto

La Baseline v1.0 §1 congela el ciclo de vida del token de verificación:
*"Generated per request · Single-use · Expires · Invalidates previous active
tokens · Does not change account status if SUSPENDED"* y *"VERIFIED occurs
upon email confirmation"*. Este ADR registra cómo se implementan esas reglas
y cierra la Fase 3 del roadmap.

## Decisión

### 1. Email obligatorio y único en el registro

`RegisterUserInput.email` es **requerido** (breaking change sobre la
Iteración 4, permitido por el nivel Experimental del contrato; al cerrar esta
iteración identity se promueve a Stable). Normalización trim + lowercase;
validación pragmática `algo@algo.tld` (no RFC 5322 completo); máximo 254
(RFC 5321). Unicidad case-insensitive vía índice `identity:emails`
(mismo patrón que usernames, ADR-0005 §3).

### 2. Puerto `EmailDelivery` en core

```ts
interface EmailDelivery { send(message: EmailMessage): Promise<DeliveryResult> }
```

Vive en core (no en identity) porque Authentication (Fase 4: reset de
contraseña) lo reutilizará. `CoreContext.email?` opcional (aditivo).
Adaptador incluido: `InMemoryEmailDelivery` con `outbox` inspeccionable
(dev/tests/bootstrap). El proveedor real (SMTP/SES/etc.) llegará con el
backend; como todo puerto, sustituible sin tocar dominio.

### 3. Tokens: aleatorios, hasheados, nunca en claro

- Valor: 32 bytes de `crypto.getRandomValues` en base64url (256 bits de
  entropía).
- **Persistencia solo del hash**: el record vive en `identity:email-tokens`
  con `id = SHA-256(token)` en hex. Beneficios: lookup O(1) determinístico
  sin índice adicional, y una fuga del almacén no revela tokens utilizables.
- Hashing con `crypto.subtle.digest` (nativo en Node 20+ y navegadores;
  cero dependencias). Nota: en navegador `crypto.subtle` exige contexto
  seguro (https o localhost) — dev cumple; producción será https.

### 4. TTL y expiración

`EMAIL_VERIFICATION_TTL_MS = 24 h`, inyectable por constructor
(`new IdentityModule({ tokenTtlMs })`) para tests y futuras políticas.
La expiración se evalúa en `confirmEmail` (`now > expiresAt` ⇒
`TokenExpiredError`); no hay limpieza activa de records expirados (deuda:
GC junto al backend).

### 5. Single active token + single-use estricto

- *Invalidates previous active tokens*: `requestEmailVerification` marca
  `invalidatedAt` en todos los tokens activos anteriores del usuario antes de
  crear el nuevo.
- *Single-use*: `confirmEmail` marca `consumedAt` **antes** de los efectos de
  dominio; un replay cae en `TokenAlreadyUsedError` aunque la confirmación
  previa haya fallado a medias.
- Orden de chequeos en `confirmEmail`: existencia → consumido → invalidado →
  expirado (errores tipados distintos para cada caso, auditables).

### 6. Reglas de estado al confirmar (Baseline literal)

- `PENDING_VERIFICATION` → `ACTIVE` (única transición disparada por
  confirmación; emite también `identity:status-changed` con
  `reason: 'email confirmed'`).
- **`SUSPENDED`: el flag `emailVerified` se marca pero el estado NO cambia**
  ("Email verification does not reactivate SUSPENDED accounts").
- Cualquier otro estado (ACTIVE, DEACTIVATED, BANNED): idem — flag sí,
  estado intacto.
- `requestEmailVerification` se permite incluso con email ya verificado
  (re-verificación / futuro cambio de email); el token se consume igual.

### 7. Búsqueda de tokens por usuario: `list()` + filtro

La invalidación de tokens anteriores recorre `identity:email-tokens` con
`list()` y filtra por `userId`. Aceptable a escala de desarrollo; con
volúmenes reales se agregará un índice secundario `userId → tokenIds`
(deuda registrada; el puerto no cambia).

### 8. Enlace de verificación

`VERIFICATION_LINK_BASE` es una constante placeholder
(`https://morningstar.app/verify-email?token=…`) hasta que exista la app
pública; el flujo es agnóstico del transporte (cualquier canal que entregue
el token funciona).

### 9. Eventos nuevos (v1, aditivos)

- `identity:verification-requested` `{ userId, email, expiresAt }`
- `identity:email-verified` `{ userId, email }`

## Consecuencias

**Positivas**
- Fase 3 cerrada: las 5 reglas de la Baseline para tokens son verificables
  (tests dedicados por regla).
- Tokens inutilizables incluso con almacén comprometido (hash-only).
- `EmailDelivery` listo para reutilizar en Fase 4 (reset de contraseña).

**Costos / deudas**
- Sin rate-limiting en `requestEmailVerification` (vector de spam): se
  abordará con Risk Engine / Authentication (Fases 4/8).
- Sin GC de tokens expirados/consumidos.
- Proveedor de email real pendiente del backend.
