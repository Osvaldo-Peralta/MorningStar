import type { Permission } from "../context/Permission"

export interface ModuleMetadata {
    id: string
    name: string
    version: string
    description?: string
    permissions?: Permission[]
}