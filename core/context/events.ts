// core/context/events.ts
export const ModuleEvents = {
    REGISTERED: 'module:registered',
    INITIALIZED: 'module:initialized',
    ACTIVATED: 'module:activated',
    DEACTIVATED: 'module:deactivated',
    DISPOSED: 'module:disposed',
    ERROR: 'module:error'
} as const