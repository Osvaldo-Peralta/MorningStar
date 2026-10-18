// authorization/domain/permissions.ts

/**
 * Modelo de permisos: strings `recurso:accion` (decisión del owner, ADR-0011).
 *
 * - Wildcards: `'*'` (todo) y `'recurso:*'` (todo el recurso, incluidos
 *   sub-niveles).
 * - Variantes de propiedad: `'recurso:accion-own'` solo satisface la petición
 *   cuando `resource.ownerId === actorId` (lo evalúa el PolicyEvaluator, que
 *   tiene el contexto).
 */
export function permissionMatches(granted: string, requested: string): boolean {
  if (granted === '*' || granted === requested) return true
  if (granted.endsWith(':*')) {
    const prefix = granted.slice(0, -1) // 'photo:*' → 'photo:'
    return requested.startsWith(prefix)
  }
  return false
}

/** ¿El permiso otorgado es una variante '-own' de la petición? */
export function isOwnVariant(granted: string, requested: string): boolean {
  return granted === `${requested}-own`
}

/** ¿El permiso otorgado es un wildcard con variante '-own' (ej. 'media:*-own')? */
export function isOwnWildcard(granted: string): boolean {
  return granted.endsWith('*-own')
}
