import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Node ≥25 habilita la Web Storage API nativa por defecto (nodejs/node#57666):
 * el global `localStorage` existe pero no es usable sin `--localstorage-file`
 * (devuelve `undefined` + ExperimentalWarning). Como la clave ya existe en el
 * global del worker, Vitest OMITE instalar el `localStorage` real de jsdom
 * (vitest-dev/vitest#8757, cerrado como "bug de Node, no soportado") y todos
 * los adaptadores que leen `localStorage` reciben `undefined`.
 * Solución: deshabilitar la webstorage nativa en los workers de test con
 * `--no-webstorage`, de modo que jsdom instale su Storage como en Node ≤24.
 * El flag no existe en Node ≤24 ("bad option"): se aplica solo desde 25.
 */
const nodeMajor = Number(process.versions.node.split('.')[0])
const workerExecArgv = nodeMajor >= 25 ? ['--no-webstorage'] : []

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
          execArgv: workerExecArgv,
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
          execArgv: workerExecArgv,
          globals: true,
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
          exclude: ['**/node_modules/**', '**/dist/**'],
          setupFiles: [path.resolve(__dirname, 'apps/web/src/test/setup.ts')],
        },
      },
    ],
  },
})
