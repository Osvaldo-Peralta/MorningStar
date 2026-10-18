// core/module/ModuleState.ts
//
// Const object en lugar de `enum`: es la forma recomendada en TypeScript
// moderno porque genera JavaScript estándar (sintaxis "erasable"), permite
// habilitar `erasableSyntaxOnly` y es compatible con la ejecución nativa
// de TypeScript en Node (type stripping).
export const ModuleState = {
    Registered: 'registered',
    Initialized: 'initialized',
    Active: 'active',
    Inactive: 'inactive',
    Disposed: 'disposed',
} as const

export type ModuleState = (typeof ModuleState)[keyof typeof ModuleState]
