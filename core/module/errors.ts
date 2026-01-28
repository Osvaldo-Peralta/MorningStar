export class ModuleError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'ModuleError'
    }
}

export class ModuleAlreadyRegisteredError extends ModuleError {
  constructor(moduleId: string) {
    super(`Module '${moduleId}' is already registered`)
    this.name = 'ModuleAlreadyRegisteredError'
    }
}

export class ModuleNotFoundError extends ModuleError {
    constructor(moduleId: string) {
        super(`Module '${moduleId}' not Found`)
        this.name = 'ModuleNotFoundError'
    }
}

export class InvalidModuleStateError extends ModuleError {
    constructor(moduleId: string, state: string) {
        super(`Module '${moduleId}' is in invalid state: ${state}`)
        this.name = 'InvalidModuleStateError'
    }
}