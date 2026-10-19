# ADR-0013 — UI de autenticación web, tests de integración y "just-in-time packages"

- Status: **Accepted**
- Date: Octubre 2026
- Deciders: Osvaldo Peralta (+ asistencia de IA)
- Relacionados: ADR-0006 (EmailDelivery), ADR-0008/0010 (sesiones/MFA), ADR-0012 (enforcement), roadmap Fase 4-5

## Contexto

Las Fases 3-5 construyeron identidad, autenticación y autorización completas,
pero la web no las usaba: sin login, sin actor, sin enforcement visible.
Esta iteración (8a) conecta la plataforma al frontend: registro, verificación
de email, login (con segundo paso MFA), sesión persistente y operaciones de
PhotoFeed con actor.

## Decisión

### 1. Arquitectura de sesión SPA: refresh token en localStorage

Sin backend HTTP no hay cookies httpOnly. Patrón elegido (estándar SPA
local-first):
- Access/session token: **solo en memoria** (React state).
- Refresh token: **localStorage** (`morningstar_v0.3.0_refresh`); al cargar,
  `AuthProvider` restaura la sesión con `authentication.refresh()`.
- Logout: revoca la sesión server-side + borra el RT.

**Deuda registrada (riesgo XSS):** cuando exista el backend, el RT migra a
cookie httpOnly y los tokens dejan de tocar storage del navegador. El módulo
de authentication no cambia: solo la composición web.

### 2. `ActorContext` en cada comando de PhotoFeed

Con `authorizer` cableado en el contexto web, PhotoFeed opera **fail-closed**
(ADR-0012): toda operación lleva `actor = { sessionToken, userId }` derivado
de la sesión real. `PermissionDeniedError`/`PermissionRequiredError` se
muestran inline. Las fotos nuevas quedan con `ownerId` del usuario.

### 3. Dev Outbox: email de desarrollo honesto

No hay proveedor de email real (llega con el backend). La web cablea
`InMemoryEmailDelivery` y renderiza un **panel Dev Outbox** (solo
`environment === 'development'`) que muestra los emails "enviados" y permite
copiar tokens de verificación/reset. `InMemoryEmailDelivery` ganó
`subscribe(listener)` (aditivo) para actualización reactiva del panel — el
polling resultó una fuente de carreras en tests.

### 4. Tests web: integración con módulos REALES (decisión del owner)

Proyecto Vitest `web` (jsdom + Testing Library + user-event +
fake-indexeddb): los tests cablean identity/authentication/authorization/
photo-feed reales con adaptadores InMemory y ejercitan la UI de punta a punta
(registro → verificación vía outbox → login → MFA → PhotoFeed con ownerId).
No se mockean módulos: la suite web es un test de integración de la
plataforma completa.

Setup técnico: `crypto.subtle` y object URLs polifilleados desde Node
(jsdom no los provee); PBKDF2 con iteraciones reducidas solo bajo
`import.meta.env.VITEST`.

### 5. Resolución de paquetes: condición `development` ("just-in-time packages")

**Bug estructural corregido de paso:** desde la Iteración 2, los aliases de
vite/vitest apuntaban al directorio del paquete, cuyo `package.json` ya tenía
`exports` ⇒ las herramientas resolvían a `dist/` **stale** (la app y los
tests corrían contra builds viejos; un crash de DevOutbox lo expuso).

Solución moderna (patrón turborepo "just-in-time packages"):
```json
"exports": { ".": { "types": "./index.ts", "development": "./index.ts", "default": "./dist/index.js" } }
```
+ `resolve.conditions: ['development']` en vite/vitest, **eliminando todos los
aliases**. Consecuencias:
- dev/tests/web-build resuelven siempre a FUENTE (.ts) — imposible stale.
- `npm run web:dev` ya no requiere `npm run build` previo.
- El runtime Node (bootstrap) sigue usando `dist/` vía condición `default`.
- Los tsconfig de paquetes y las Project References no cambian.

### 6. Estructura de la UI

- `AuthGate` (App.tsx): loading | anonymous → `AuthScreen` | authenticated →
  `PhotoFeed`.
- `AuthScreen`: máquina de estados `login | register | mfa | pending`, con
  errores inline (cero `alert`), resultado discriminado `AuthOutcome` desde
  `AuthContext`.
- Higiene: los estados de contraseña se limpian al cambiar de modo/flujo
  (bug real detectado por los tests: el estado compartido entre formularios
  duplicaba la contraseña al tipear).
- `tsconfig.test.json` separado: la app mantiene tipos DOM puros; los tests
  obtienen tipos de Node.

### 7. Fingerprint web mínimo

`webDeviceFingerprint()`: UUID persistente por navegador (localStorage). Es
un fingerprint honesto-but-simple; el fingerprinting robusto y el DeviceTrust
llegan con el Risk Engine (Fase 8).

## Consecuencias

**Positivas**
- La plataforma es usable y demostrable en navegador: alta → verificación →
  login (con MFA) → feed con propiedad y permisos.
- Suite web = regression de integración de toda la plataforma.
- Fin del footgun de dist stale en desarrollo.

**Costos / deudas**
- RT en localStorage (XSS) hasta backend con httpOnly cookies.
- UI de gestión MFA (QR de enrolamiento), reset de contraseña y "tus
  dispositivos": Iteración 8b.
- Dev Outbox visible en development (a propósito; nunca en producción).
