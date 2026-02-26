// core/context/Config.ts
export interface CoreConfig {
    environment: "development" | "test" | "production"
    version: string
}