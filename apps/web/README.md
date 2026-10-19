# MorningStar Web

Frontend React + Vite + Tailwind de MorningStar. Consume los paquetes del
monorepo por **fuente** (condición de exports `development`, ADR-0013): no
hace falta compilar los paquetes antes de `web:dev`.

## Scripts (desde la raíz del monorepo)

```bash
npm run web:dev        # servidor de desarrollo
npm run web:build      # type-check (tsc -b) + build de producción
npm run web:preview    # previsualizar el build
npm test               # suite completa (proyecto vitest 'web': jsdom + Testing Library)
```

## Arquitectura

- `context/AppContext.tsx` — composición de la plataforma: infraestructura
  (adapters), módulos (photo-feed, identity, authentication, authorization) y
  puertos cruzados. Incluye `authorizer` ⇒ PhotoFeed opera fail-closed con
  `ActorContext` (ADR-0012/0013).
- `context/AuthContext.tsx` — sesión del navegador: login/registro/MFA,
  restauración con refresh token (localStorage — deuda httpOnly cookie,
  ADR-0013), `actor` para los comandos y gestión de cuenta (8b): cambio de
  contraseña, request/reset self-service, MFA (status/enroll/confirm/disable),
  `listSessions`/`revokeSession` y avisos transitorios (`notice`).
- `App.tsx` — AuthGate: `loading | anonymous → AuthScreen | authenticated → PhotoFeed`.
- `components/auth/AuthScreen.tsx` — máquina de estados
  `login | register | mfa | pending | forgot | reset` (reset de contraseña
  self-service vía email/Dev Outbox, 8b).
- `components/auth/SecurityModal.tsx` — panel "Seguridad" (8b, ADR-0014):
  enrolamiento MFA con QR (`qrcode.react`) + secret manual, backup codes con
  copia/descarga (entrega única), cambio de contraseña y "Tus dispositivos"
  (sesiones activas con badge "Este dispositivo" y revocación remota).
- `components/auth/DevOutbox.tsx` — panel de desarrollo con los emails
  "enviados" por `InMemoryEmailDelivery` (solo `environment=development`).
- `components/auth/notes.tsx` — piezas compartidas de UI (inputs/botones,
  notas error/info accesibles).

## Tests

Los tests web (`src/test/`) son de **integración real**: cablean los módulos
de la plataforma con adaptadores InMemory sobre jsdom y ejercitan la UI de
punta a punta. Harness compartido en `src/test/helpers.tsx` (render, registro,
verificación vía outbox, login/logout, apertura del panel de Seguridad).
Setup en `src/test/setup.ts` (jest-dom, fake-indexeddb, polyfills de
`crypto.subtle` y object URLs). Type-check de tests con `tsconfig.test.json`
(separado del de la app).

> **Node ≥25:** la webstorage nativa de Node sombrea el `localStorage` de
> jsdom en los workers de Vitest (vitest-dev/vitest#8757). El
> `vitest.config.ts` de la raíz lo desactiva con `execArgv: ['--no-webstorage']`
> (solo Node ≥25); no hace falta ninguna acción manual.
