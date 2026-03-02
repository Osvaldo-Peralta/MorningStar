import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['packages/**/*.test.ts'],
    exclude: ['node_modules', 'dist']
  },
  resolve: {
    alias: {
      '@morningstar/core': path.resolve(__dirname, 'packages/core'),
      '@morningstar/photo-feed': path.resolve(__dirname, 'packages/photo-feed'),
      '@morningstar/runtime-logger': path.resolve(__dirname, 'packages/runtime-logger'),
    },
  },
})