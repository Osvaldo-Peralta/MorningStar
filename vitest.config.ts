import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['**/*.test.ts'],
    exclude: [
      'node_modules',
      'dist',
      'web'
    ]
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, './core'),
      '@modules': path.resolve(__dirname, './modules'),
    },
  },
})
