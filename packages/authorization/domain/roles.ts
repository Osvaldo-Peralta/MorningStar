// authorization/domain/roles.ts

export interface RoleDefinition {
  readonly name: string
  readonly permissions: readonly string[]
  readonly description?: string
}

/** Rol por defecto de toda cuenta ACTIVE sin asignaciones explícitas. */
export const DEFAULT_ROLE = 'member'
/** Rol de cuentas no-ACTIVE (permisos nulos; el evaluador además las DENiega). */
export const INACTIVE_ROLE = 'guest'

/**
 * Roles built-in (decisión del owner, ADR-0011). La composición puede
 * agregar roles propios vía `AuthorizationModuleOptions.extraRoles`;
 * los built-in no se pueden eliminar (ampliar sí, por composición de listas).
 */
export const BUILTIN_ROLES: readonly RoleDefinition[] = [
  {
    name: 'guest',
    permissions: [],
    description: 'Cuentas no-ACTIVE: sin permisos',
  },
  {
    name: 'member',
    permissions: [
      'photo:create',
      'photo:list',
      'photo:view',
      'photo:edit-own',
      'photo:delete-own',
      'profile:view',
      'profile:edit-own',
    ],
    description: 'Default de toda cuenta ACTIVE',
  },
  {
    name: 'creator',
    permissions: ['media:publish', 'media:edit-own', 'media:delete-own', 'content:publish'],
    description: 'Publicación de contenido propio',
  },
  {
    name: 'moderator',
    permissions: ['photo:hide', 'photo:delete', 'content:review', 'user:suspend'],
    description: 'Moderación de contenido y usuarios',
  },
  {
    name: 'admin',
    permissions: ['*'],
    description: 'Administración total',
  },
]

/**
 * Permisos sensibles: aunque un rol los otorgue, la decisión es CONDITIONAL
 * con 'require-mfa' (materializa "Re-auth required for sensitive changes",
 * Baseline §1). Configurable por instancia.
 */
export const SENSITIVE_PERMISSIONS: readonly string[] = [
  'account:*',
  'user:suspend',
  'user:ban',
  'role:*',
]
