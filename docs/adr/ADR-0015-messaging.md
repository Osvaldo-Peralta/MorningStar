# ADR-0015 — Messaging: conversaciones 1:1/grupales, actor obligatorio y soft delete

- Status: **Accepted**
- Date: Octubre 2026
- Deciders: Osvaldo Peralta (+ asistencia de IA)
- Relacionados: ADR-0001 (eventos), ADR-0002 (dependencias), ADR-0003 (persistencia), ADR-0011 (authorization), ADR-0012 (enforcement), roadmap Fase 6

## Contexto

La Fase 6 (comunidades y comunicación) arranca con la capa más básica del
producto: mensajería entre usuarios. El roadmap pide chat 1:1 y grupal hoy,
y canales/servidores con roles propios después; la experiencia previa del
proyecto (photo-feed) dejó dos lecciones:

1. Nacer sin `ownerId`/actor costó una iteración de enforcement (7b) y dejó
   fotos legacy sin dueño (deuda). Los módulos nuevos deben nacer con
   `ActorContext` + Authorizer desde el día uno (patrón 7b, decidido en el
   handoff de la Fase 5).
2. El modo abierto sin autorización es deuda técnica inmediata: la privacidad
   de las conversaciones no puede depender de que la composición recuerde
   cablear un authorizer.

Decisiones del owner para este corte (votadas): alcance 1:1 + grupos (sin
canales todavía), núcleo de mensajes sin reacciones/recibos, y backend-first
(la UI de chat llega en 9b).

## Decisión

### 1. Un solo módulo `messaging`, prefijo `msg:`

Conversaciones y mensajes viven en el mismo módulo (mismo agregado raíz de
flujo: la conversación). Canales/comunidades serán un módulo separado
(`community:`, prefijo reservado) cuando llegue su corte: la mensajería no
debe conocer la estructura social (ADR-0002: integración por eventos/puertos).

### 2. `ActorContext` obligatorio en TODA la API pública

A diferencia de photo-feed (que conserva `actor?` por compatibilidad legacy),
messaging no tiene consumidores históricos: el actor es un parámetro
requerido en cada método y su ausencia lanza `PermissionRequiredError` haya o
no authorizer. El enforcement por roles (ADR-0012) sigue siendo condicional a
`context.authorizer`, pero la identificación del actor no.

### 3. Privacidad como invariante de dominio, no como política

Solo los participantes de una conversación pueden leerla o escribir en ella.
Es una invariante del módulo, SIEMPRE activa e independiente del Authorizer:
un `ALLOW` de rol no habilita a un intruso. `ConversationNotAccessibleError`
es idéntico para "no existe" y "no participas" (anti-sondeo, misma filosofía
que authentication).

Excepción deliberada — **moderación de borrado**: con authorizer presente, un
rol con `msg:delete` pleno (built-in `moderator`) puede borrar mensajes ajenos
aun sin participar de la conversación (Baseline: moderación de contenido).
La **edición no tiene excepción**: `editMessage` es siempre solo del autor
(integridad semántica de `editedAt`: un mensaje "editado" por un tercero no
es una edición, es censura — y la censura se modela como borrado).

### 4. Mensajes: texto plano con soft delete y `seq` monotónico

- **Soft delete (tombstone)**: borrar marca `deletedAt` y vacía el cuerpo
  (privacidad: el texto no sobrevive), preservando la continuidad y el orden
  de la conversación (la UI mostrará "mensaje eliminado"). Borrado físico y
  GC: deuda.
- **Edición** sin historial: solo `editedAt` (el historial completo es deuda
  registrada; si se necesita, será aditivo).
- **`seq` por conversación** (1, 2, 3…, persistido): el orden canónico.
  `createdAt` puede empatar (milisegundos) y `list()` de los repositorios no
  garantiza orden; `seq` da paginación por cursor determinista incluso tras
  rehidratar.

### 5. Paginación por cursor hacia atrás

`listMessages(conversationId, { limit?, before? })` devuelve la ventana más
reciente en orden ascendente con `nextCursor` (id del mensaje más viejo de la
página) cuando hay anteriores: el patrón estándar de chat (scroll infinito
hacia el pasado). `limit` acotado (1..200, default 50). Sin offsets: los
mensajes son append-only y el cursor por id es estable ante inserciones.

### 6. DMs idempotentes por par de usuarios

`getOrCreateDirectConversation` deduplica por clave canónica del par
(`directPairKey`): A→B y B→A devuelven la misma conversación; no existen DMs
duplicados. Reconstruible desde los records al rehidratar (sin índice
persistido extra). Self-DM rechazado (v1).

### 7. Permisos `msg:*` en los roles built-in (aditivo)

`member`: `msg:send`, `msg:read`, `msg:edit-own`, `msg:delete-own`.
`moderator`: `msg:delete`. Las variantes `-own` usan el `ownerId=authorId`
del recurso (mecanismo existente del PolicyEvaluator, ADR-0011). Los permisos
de conversación futura (`msg:create-channel`, roles de comunidad, etc.)
llegarán con el módulo de comunidades, no se especulan ahora.

### 8. Sin validación de identidad de los participantes (v1)

Los `participantIds` son strings opacos: messaging NO importa identity
(feature↔feature prohibido, ADR-0002). Un puerto opcional de directorio
(patrón `UserDirectoryPort` de authentication) llegará cuando la UI lo
necesite (9b) o comunidades requiera membresías validadas.

## Consecuencias

**Positivas**
- Primer módulo que nace fail-closed completo: sin deuda de modo anónimo.
- La paginación por `seq` funcionará igual con un backend real (el cursor es
  un id estable, no un offset frágil).
- `authorization` crece de forma aditiva (permisos nuevos en roles
  existentes); ningún consumidor existente cambia de comportamiento.

**Costos / riesgos**
- Actor obligatorio hace el módulo inutilizable sin sesión: los tests y el
  bootstrap componen actores reales (aceptado: es el comportamiento deseado).
- La moderación sin participación exige authorizer presente; en modo abierto
  (tests unitarios) solo el autor borra. Documentado en el contrato.
- Tombstones crecen sin GC (deuda registrada, un único job futuro con el
  GC de sesiones/tokens).
