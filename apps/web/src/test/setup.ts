// Setup de los tests web (proyecto 'web' de Vitest, entorno jsdom).
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { webcrypto } from 'node:crypto'
import 'fake-indexeddb/auto'

// jsdom no implementa SubtleCrypto: lo tomamos del webcrypto de Node
// (identity/authentication usan SHA-256 y PBKDF2 vía crypto.subtle).
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
  })
}

// jsdom no implementa object URLs (IndexedDbMediaStorage.getUri las usa).
if (typeof URL.createObjectURL !== 'function') {
  URL.createObjectURL = () => 'blob:mock-object-url'
  URL.revokeObjectURL = () => {}
}

afterEach(() => {
  cleanup()
  localStorage.clear()
})

// El RuntimeLoggerModule registra cada evento por console.log: en tests web
// se silencia el ruido (los errores reales siguen visibles).
const originalError = console.error
const originalWarn = console.warn
console.log = () => {}
console.info = () => {}
console.debug = () => {}
console.error = (...args: unknown[]) => {
  // Filtrar solo los logs de errores de módulos esperados en tests
  const text = String(args[0] ?? '')
  if (text.includes('[ERROR]') || text.includes('Bootstrap')) return
  originalError(...args)
}
console.warn = originalWarn.bind(console)
