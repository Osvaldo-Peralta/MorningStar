# ADR-0005 — Identity: dominio, ciclo de vida de cuenta y políticas

- Status: **Accepted**
- Date: Octubre 2026
- Deciders: Osvaldo Peralta (+ asistencia de IA)
- Relacionados: Baseline v1.0 §1 (frozen), ADR-0002 (dependencias), ADR-0003 (Persistence), roadmap Fase 3

## Contexto

La Fase 3 del roadmap pide implementar Identity según la Baseline v1.0 §1:
agregado `User`, estados de cuenta, tipos de cuenta, verificación y políticas
de transición — como dominio independiente de authentication/authorization.
Por decisión de scope, la Fase 3 se parte en dos iteraciones: **esta
(dominio)** y la Iteración 5 (verificación por email).

## Decisión

### 1. Paquete `@morningstar/identity` (feature → core)

Módulo de funcionalidad estándar (ADR-0002): depende solo de `core`, extiende
`CoreEventMap` por augmentation, expone API pública por `index.ts` + `exports`.

### 2. El agregado no se expone: `UserSnapshot` como modelo de lectura

La Baseline menciona *"internal flags"*. Para protegerlos, los comandos y
consultas devuelven `UserSnapshot` (datos planos de solo lectura), nunca la
instancia de `User`. El agregado usa `#privates` (patrón de photo-feed).

### 3. Username: normalización e índice de unicidad

- Normalización: trim + lowercase ⇒ unicidad case-insensitive.
- Charset alfanumérico estricto `[a-z0-9]` (Baseline: "unique, alphanumeric").
- Longitud 3–32 (no definida en la Baseline; se fija aquí).
- Unicidad garantizada por un **repositorio índice** `identity:usernames`
  (`id = username normalizado → userId`): verificación O(1) sin escanear
  usuarios, y coherente con el modelo de repositorios por namespace.
- Orden de escritura: usuario → índice (fallo intermedio = usuario sin
  índice, recuperable; nunca índice colgado).

### 4. displayName: Unicode completo

Se valida por **code points** (no UTF-16 units): emojis y caracteres astrales
cuentan 1. Límite 1–100 tras trim.

### 5. Ciclo de vida de `AccountStatus`

Tabla de transiciones en `StatusTransitionPolicy` (dominio puro), fiel a las
reglas de la Baseline:

- `PENDING_VERIFICATION → ACTIVE` existe en la política pero su disparador
  legítimo es `confirmEmail` (Iteración 5): *"VERIFIED occurs upon email
  confirmation"*. `changeStatus` es hoy un comando de sistema/admin.
- `SUSPENDED → ACTIVE` solo por comando explícito — *"No automatic
  reactivation from SUSPENDED"*; la verificación de email nunca reactiva.
- `DEACTIVATED → ACTIVE` (recuperación) quedará condicionado a re-auth cuando
  exista Authentication (Fase 4).
- **`BANNED` es terminal** (decisión explícita del owner): ningún camino de
  salida; un futuro unban requerirá ADR nuevo + Audit Trail (Fase 8).
- Transición al mismo estado: rechazada (no-op inválido).

### 6. `AccountType`: conversiones MVP

`PERSONAL ↔ CREATOR` permitido. Hacia/desde `OFFICIAL` y `GOVERNMENT`
bloqueado hasta definir sus flujos de verificación (error explícito
`InvalidAccountTypeConversionError`). Cuenta nueva: `PERSONAL` por defecto.

### 7. Eventos `identity:*` (v1)

`identity:registered`, `identity:status-changed` (con `from`/`to`/`reason?`),
`identity:profile-updated`, `identity:type-changed`. Registration por
augmentation; payloads aditivos según ADR-0001.

### 8. Re-auth diferido (forma del API futura)

*"Re-auth required for sensitive changes"* no puede implementarse sin
Authentication (Fase 4). Se registra aquí la intención: los comandos
sensibles (`changeStatus`, `changeAccountType`, y futuros `changeUsername`/
`deleteAccount`) incorporarán un parámetro de contexto de actor cuando exista
el módulo de sesiones; los consumidores actuales (sistema/admin) quedan
documentados como tales.

## Consecuencias

**Positivas**
- Dominio puro y exhaustivamente testeable (políticas sin infraestructura).
- Unicidad de username robusta y O(1); identidad estable heredada de
  Persistence.
- La Iteración 5 (email) y la Fase 4 (auth) encajan sin romper este contrato:
  `markEmailVerified` y el contexto de actor ya están previstos.

**Costos**
- Doble escritura usuario+índice sin transaccionalidad (mitigado por el orden
  de escritura; reconstrucción de índice posible como utilidad futura).
- `changeStatus` sin control de actor hasta Fase 4 (documentado como comando
  de sistema).
