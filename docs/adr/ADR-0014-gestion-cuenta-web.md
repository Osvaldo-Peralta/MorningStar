# ADR-0014 — UI de gestión de cuenta: QR de MFA en el cliente y revocación de sesiones por dispositivo

- Status: **Accepted**
- Date: Octubre 2026
- Deciders: Osvaldo Peralta (+ asistencia de IA)
- Relacionados: ADR-0008 (sesiones), ADR-0009 (refresh/reset), ADR-0010 (MFA), ADR-0013 (UI auth web), roadmap Fase 4

## Contexto

La Iteración 8a conectó login/registro/MFA-challenge a la web, pero la
gestión de cuenta seguía sin UI: enrolamiento MFA (el módulo ya genera
`otpauthUri`), backup codes, cambio/reset de contraseña y "tus dispositivos"
(`listSessions`) solo eran accesibles programáticamente. Dos vacíos de
plataforma:

1. **QR de enrolamiento:** las apps de autenticación esperan un código QR
   con la URI `otpauth://`. No hay backend que pueda generarlo/renderizarlo.
2. **Revocación por dispositivo:** `logout(token)` exige el token de la
   sesión (solo se posee el de la sesión actual) y `logoutUser` revoca todas.
   Cerrar UN dispositivo remoto de la lista de `listSessions` no era posible.

## Decisión

### 1. QR renderizado en el cliente con `qrcode.react` (decisión del owner)

Opciones evaluadas (votación del owner):
- **`qrcode.react` (ELEGIDA):** componente React (`QRCodeSVG`), cero
  dependencias, ~10 KB, ISC. Renderiza SVG en el DOM: testeable en jsdom sin
  canvas ni mocks.
- `qrcode` (genérica): produce data-URL/SVG como string; útil si algún día el
  backend necesita generar QR (emails). Más pesada en el bundle web.
- Sin dependencia (solo secret manual): peor UX, el secret sigue visible de
  todos modos como fallback.

El QR se genera **100% en el cliente** a partir de `otpauthUri`
(`TotpService.generateTotpUri`): el secret TOTP ya se entrega al cliente por
diseño (ADR-0010 §entrega única) y no se añade superficie de red. El
**secret manual se muestra siempre junto al QR** (fallback sin cámara).

Los backup codes mantienen la entrega única de `confirmMfa`: la UI los
muestra una sola vez con botones **Copiar** y **Descargar .txt** (Blob +
object URL). No hay "volver a verlos" (en reposo solo existen hashes
SHA-256); la regeneración sigue registrada como deuda (camino actual:
disable + re-enroll).

### 2. `revokeSessionById(userId, sessionId)` en authentication (aditivo)

Método público nuevo que complementa los tres niveles de revocación
existentes (sesión por token / usuario / global). Busca el record por id
(ids expuestos por `listSessions`; nunca tokens), exige que pertenezca a
`userId` y esté activa, y reutiliza la revocación privada con reason nuevo
**`device-revoked`** (literal aditivo a `SessionRevokedReason`; emite el
evento existente `auth:session-revoked`). Anti-sondeo: `false` idéntico para
id inexistente, ajeno, revocado o expirado.

### 3. Panel "Seguridad" como modal desde PhotoFeed (decisión del owner)

Sin router en la app (no se introduce en 8b): el panel es un `Modal`
reutilizado con tres secciones internas (Dos pasos / Contraseña /
Dispositivos), entrada por botón "Seguridad" en el header. Alternativa
descartada: mini-router de pantallas (excede el alcance UI de 8b).

Flujos con efectos de sesión honestos:
- **Cambio de contraseña:** el backend revoca todas las sesiones
  (`password-changed`); la UI limpia el estado local y el AuthScreen muestra
  aviso transitorio (`notice` del AuthContext) pidiendo re-login.
- **Reset self-service:** "¿Olvidaste tu contraseña?" en AuthScreen →
  `requestPasswordReset` (mensaje anti-enumeración idéntico exista o no la
  cuenta) → token desde el email (Dev Outbox en desarrollo, ADR-0013) →
  `resetPassword` → login con la nueva contraseña.
- **Dispositivos:** badge "Este dispositivo" comparando el `sessionId` del
  AuthContext (adoptado en login/refresh); revocación individual y "cerrar
  las demás sesiones". Revocar la sesión actual equivale a logout local.

### 4. Tests de integración con TOTP real

Los tests web (ADR-0013) generan códigos TOTP **reales** con `TotpService` a
partiendo del secret que muestra la UI y verifican el estado del módulo sin
mocks. Para el caso de desactivación se usa un backup code (determinista;
evita la dependencia de la ventana de 30 s). Harness compartido extraído a
`apps/web/src/test/helpers.tsx`.

## Consecuencias

- `apps/web` gana una dependencia runtime (`qrcode.react@^4`); el bundle
  sube ~10 KB gzip.
- `authentication` (Stable) recibe un método y un literal de reason
  **aditivos**: sin breaking changes; contrato actualizado en el mismo
  commit.
- La deuda "UI de gestión MFA / reset / dispositivos" queda cerrada; siguen
  abiertas: regeneración de backup codes, notificaciones por email de
  cambios de seguridad y cookies httpOnly (backend).
- Si en el futuro el backend necesita generar QR (p. ej. por email), se
  evaluará `qrcode` en ese lado sin tocar la web.
