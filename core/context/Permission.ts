// core/context/Permission.ts
export type Permission = 
| "filesystem"
| "network"
| "notifications"
| "camera"
| "microphone"

export interface Permissions {
    has(permission: Permission): boolean
    request(permission: Permission): Promise<boolean>
}