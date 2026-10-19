import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Vitest projects (v4): dos entornos de test en un mismo comando.
 * - `packages`: entorno node, suites de dominio/infraestructura.
 * - `web`: entorno jsdom con Testing Library; los tests cablean los módulos
 *   REALES con adaptadores InMemory (integración de punta a punta, ADR-0013).
 *
 * Resolución de paquetes del monorepo: condición de exports `development`
 * (patrón "just-in-time packages"): dev/tests resuelven a la FUENTE .ts,
 * el runtime Node (bootstrap) resuelve a dist. Sin aliases — nunca más
 * dist stale en desarrollo.
 */
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { conditions: ['development'] },
        test: {
          name: 'packages',
          environment: 'node',
          globals: true,
          include: ['packages/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**'],
        },
      },
      {
        plugins: [react()],
        resolve: { conditions: ['development'] },
        test: {
          name: 'web',
          environment: 'jsdom',
          globals: true,
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          setupFiles: [path.resolve(__dirname, 'apps/web/src/test/setup.ts')],
        },
      },
    ],
  },
})
