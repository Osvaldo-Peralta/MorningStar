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
  ADR-0013) y `actor` para los comandos.
- `App.tsx` — AuthGate: `loading | anonymous → AuthScreen | authenticated → PhotoFeed`.
- `components/auth/AuthScreen.tsx` — máquina de estados `login | register | mfa | pending`.
- `components/auth/DevOutbox.tsx` — panel de desarrollo con los emails
  "enviados" por `InMemoryEmailDelivery` (solo `environment=development`).

## Tests

Los tests web (`src/test/`) son de **integración real**: cablean los módulos
de la plataforma con adaptadores InMemory sobre jsdom y ejercitan la UI de
punta a punta. Setup en `src/test/setup.ts` (jest-dom, fake-indexeddb,
polyfills de `crypto.subtle` y object URLs). Type-check de tests con
`tsconfig.test.json` (separado del de la app).
