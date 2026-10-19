// core/context/Actor.ts

/**
 * Contexto del actor de una operación (ADR-0012).
 *
 * Frontera de confianza: lo construye SIEMPRE la composición (backend/
 * bootstrap) a partir de una sesión ya validada — NUNCA se acepta tal cual
 * de claims crudos del cliente. `userId` se usa para stamping de propiedad;
 * `sessionToken` es lo que el Authorizer valida (la identidad real la
 * demuestra el token, no el campo userId).
 */
export interface ActorContext {
  readonly sessionToken: string
  readonly userId: string
}
