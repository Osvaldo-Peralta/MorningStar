# Contrato — `@morningstar/messaging`

> Mensajería de la Fase 6 (comunidades y comunicación), corte 9a: el dominio
> de conversaciones y mensajes. Ver ADR-0015.

- Estabilidad: **Experimental**
- Versión del paquete: 0.1.0
- Dueño de prefijos de eventos: `msg:` (registrado en README.md)
- Dependencias: `@morningstar/core` (+ `nanoid` para ids)

Conversaciones 1:1 (idempotentes por par) y grupales con mensajes de texto:
envío, edición y borrado soft (tombstone), listados paginados por cursor.
NO es: canales/comunidades con roles propios (iteraciones siguientes de la
Fase 6), adjuntos multimedia (Fase 7), transporte en tiempo real (requiere
backend).

---

## 1. API pública — `MessagingModule`

```ts
export class MessagingModule implements AppModule {
  readonly id = 'messaging'
  readonly version: string          // '0.1.0'
  state: ModuleState

  constructor(options?: MessagingModuleOptions)  // { policy?: MessagingPolicyOverrides }

  // Conversaciones
  getOrCreateDirectConversation(otherUserId: string, actor: ActorContext): Promise<ConversationInfo>
  createGroupConversation(input: { title?: string; participantIds: readonly string[] }, actor: ActorContext): Promise<ConversationInfo>
  getConversation(conversationId: string, actor: ActorContext): Promise<ConversationInfo>
  listConversations(actor: ActorContext): Promise<ConversationInfo[]>

  // Mensajes
  sendMessage(conversationId: string, body: string, actor: ActorContext): Promise<MessageInfo>
  editMessage(messageId: string, body: string, actor: ActorContext): Promise<MessageInfo>
  deleteMessage(messageId: string, actor: ActorContext): Promise<void>
  listMessages(conversationId: string, page?: { limit?: number; before?: string }, actor: ActorContext): Promise<MessagePage>
}

export interface ConversationInfo {
  readonly conversationId: string
  readonly kind: 'direct' | 'group'
  readonly participantIds: readonly string[]
  readonly title?: string           // solo group
  readonly createdBy: string
  readonly createdAt: number
  readonly lastMessageAt?: number   // ausente hasta el primer mensaje
}

export interface MessageInfo {
  readonly messageId: string
  readonly conversationId: string
  readonly authorId: string
  readonly seq: number              // monotónico por conversación (1-based)
  readonly body: string             // '' en tombstones
  readonly createdAt: number
  readonly editedAt?: number
  readonly deletedAt?: number
}

export interface MessagePage {
  readonly messages: readonly MessageInfo[]  // orden cronológico ascendente
  readonly nextCursor?: string               // presente si quedan mensajes anteriores
}
```

**`ActorContext` es obligatorio en TODA la API** (a diferencia de photo-feed,
no hay modo anónimo legacy): sin actor ⇒ `PermissionRequiredError`, haya o no
authorizer (ADR-0015).

| Método | Precondiciones | Comportamiento | Errores |
|---|---|---|---|
| `getOrCreateDirectConversation(otherUserId, actor)` | actor; otherUserId no vacío y distinto del actor; permiso `msg:send` | **Idempotente por par**: si la DM ya existe (en cualquier dirección A↔B) la devuelve; si no, la crea (`kind:'direct'`, creador participante), persiste y emite `msg:conversation-created` | `PermissionRequiredError`, `PermissionDeniedError`, `InvalidParticipantsError` |
| `createGroupConversation(input, actor)` | actor; ≥2 participantes únicos tras agregar al creador; título opcional ≤ `maxTitleLength`; permiso `msg:send` | Crea SIEMPRE una conversación nueva (`kind:'group'`), persiste y emite `msg:conversation-created` | `PermissionRequiredError`, `PermissionDeniedError`, `InvalidParticipantsError`, `InvalidConversationTitleError` |
| `getConversation(id, actor)` | actor participante; permiso `msg:read` | Devuelve `ConversationInfo` | `ConversationNotAccessibleError` (mismo error si no existe: anti-sondeo), `PermissionDeniedError` |
| `listConversations(actor)` | actor; permiso `msg:read` | Conversaciones donde el actor participa, ordenadas por `lastMessageAt ?? createdAt` descendente | `PermissionRequiredError`, `PermissionDeniedError` |
| `sendMessage(conversationId, body, actor)` | actor participante; cuerpo 1..`maxBodyLength` tras trim; permiso `msg:send` | Crea el mensaje con el próximo `seq`, actualiza `lastMessageAt`, persiste ambos records y emite `msg:sent` | `ConversationNotAccessibleError`, `InvalidMessageBodyError`, `PermissionDeniedError` |
| `editMessage(messageId, body, actor)` | **solo el autor** (invariante, ni admin edita ajenos); mensaje vivo; permiso `msg:edit` | Cuerpo idéntico ⇒ no-op sin evento; distinto ⇒ actualiza + `editedAt`, persiste y emite `msg:edited` | `MessageNotFoundError`, `NotMessageAuthorError`, `MessageAlreadyDeletedError`, `InvalidMessageBodyError`, `PermissionDeniedError` |
| `deleteMessage(messageId, actor)` | mensaje vivo; permiso `msg:delete`; autor siempre puede; **no-autor solo con authorizer que otorgue `msg:delete` pleno** (moderación, ADR-0015) | Soft delete: `deletedAt` + cuerpo vaciado; persiste y emite `msg:deleted` | `MessageNotFoundError`, `NotMessageAuthorError`, `MessageAlreadyDeletedError`, `PermissionDeniedError` |
| `listMessages(conversationId, page?, actor)` | actor participante; permiso `msg:read` | Ventana ascendente por `seq`; `before` exclusivo; `limit` acotado a 1..`maxPageSize` (default `defaultPageSize`); `nextCursor` = id del primer mensaje cuando quedan anteriores; **incluye tombstones** (`body:''`) | `ConversationNotAccessibleError`, `InvalidCursorError`, `PermissionDeniedError` |

Invariantes del dominio:
- `direct`: exactamente 2 participantes distintos, sin título. `group`:
  2..`maxParticipants` únicos; el creador siempre participa; título opcional.
- Participantes fijos en v1 (agregar/quitar miembros será aditivo).
- `seq` monotónico por conversación, persistido: orden determinista incluso
  con `createdAt` empatados y tras rehidratar.

## 2. Dominio

- `Conversation` y `Message`: agregados con privados reales `#`, getters con
  copias defensivas, `toRecord/fromRecord` (ADR-0003). Internos aunque se
  exporten (tests los usan): validadores estáticos.
- `MESSAGING_POLICY` / `MessagingPolicyOverrides` / `resolveMessagingPolicy`:
  defaults `{ maxBodyLength: 4000, minParticipants: 2, maxParticipants: 100,
  maxTitleLength: 100, defaultPageSize: 50, maxPageSize: 200 }`.
- `directPairKey(a, b)`: clave canónica del par (dedup de DMs).

## 3. Eventos emitidos (ADR-0001, prefijo `msg:`)

| Evento | Cuándo | Payload | Versión |
|---|---|---|---|
| `msg:conversation-created` | tras crear una conversación (no en el get de una DM existente) | `{ conversationId, kind, participantIds, title?, createdBy, createdAt }` | v1 |
| `msg:sent` | tras persistir un mensaje nuevo | `{ messageId, conversationId, authorId, seq, body, createdAt }` | v1 |
| `msg:edited` | solo con cambio real de cuerpo | `{ messageId, conversationId, authorId, body, editedAt }` | v1 |
| `msg:deleted` | tras el soft delete | `{ messageId, conversationId, deletedBy, deletedAt }` | v1 |

Augmentation de `CoreEventMap` en `MessagingEventMap.ts` (patrón ADR-0002:
la dependencia va solo messaging → core).

## 4. Eventos consumidos

| Evento | De qué módulo | Reacción |
|---|---|---|
| — | — | — (v1 pasiva; futuras reacciones a `identity:`/`auth:` son aditivas) |

## 5. Persistencia

| Clave | Contenido | Escritura |
|---|---|---|
| `messaging:conversations` | `ConversationRecord[]` (planos) | creación, `touch` por mensaje nuevo |
| `messaging:messages` | `MessageRecord[]` (planos, con `seq`) | envío, edición, borrado (tombstone persiste) |

- `context.persistence` es **obligatorio** (error explícito en `init`).
- Rehidratación en `init`: agregados + índices (participantes, dedup de DMs,
  orden por `seq`, próximo `seq`).
- Los cuerpos de mensajes borrados NO sobreviven (privacidad); el tombstone
  conserva metadata para no romper el orden/continuidad.

## 6. Permisos y configuración

- Enforcement (ADR-0012, patrón 7b) cuando `context.authorizer` existe:
  - `msg:send` — crear conversaciones y enviar (`resource {type:'conversation', id?}`).
  - `msg:read` — listar/leer (`resource {type:'conversation', id}` en lecturas acotadas).
  - `msg:edit` / `msg:delete` — con `resource {type:'message', id, ownerId: authorId}`
    (las variantes `-own` de los roles resuelven autoría).
- DENY/CONDITIONAL ⇒ `PermissionDeniedError` **sin efectos colaterales**;
  CONDITIONAL se trata como denegación (enforcement loop: deuda ADR-0011 §6).
- Roles built-in (authorization, aditivo 9a): `member` ⇒ `msg:send`,
  `msg:read`, `msg:edit-own`, `msg:delete-own`; `moderator` ⇒ `msg:delete`.
- **Invariante de dominio independiente de roles**: solo los participantes
  acceden a una conversación (un ALLOW de rol no habilita intrusos).
- No usa el puerto `Permissions` ni `CoreConfig`.

## 7. Deuda conocida

- Participantes fijos: falta API aditiva para agregar/quitar miembros de
  grupos (y roles de conversación: admin/owner del grupo) — llega con
  comunidades/canales (Fase 6, cortes siguientes).
- Sin validación de que los `participantIds` existan en identity (los ids son
  opacos; un puerto de directorio opcional llegará con la UI de chat 9b o
  comunidades, para no violar feature↔feature, ADR-0002).
- Sin adjuntos/media (Fase 7), reacciones, recibos de lectura ni hilos.
- Sin GC de conversaciones vacías ni de tombstones antiguos.
- Sin transporte en tiempo real (websocket/push): los consumidores se
  actualizan por eventos del bus (UI web los suscribirá en 9b).
- Historial de ediciones no conservado (solo `editedAt`).
