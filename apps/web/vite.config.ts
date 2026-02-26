import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@morningstar/core': path.resolve(__dirname, '../../packages/core'),
      '@morningstar/photo-feed': path.resolve(__dirname, '../../packages/photo-feed'),
      '@morningstar/runtime-logger': path.resolve(__dirname, '../../packages/runtime-logger'),
    }
  }
})