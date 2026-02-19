// web/vite.config.ts
import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  // Mantenemos el root en la carpeta 'web' para que encuentre el index.html
  root: path.resolve(__dirname, '.'),
  // Crucial para que Vite pueda servir archivos desde afuera de `web/src`
  server: {
    fs: {
      allow: ['..', '../core', '../modules']
    }
  },
  resolve: {
    alias: {
      // Alias para rutas limpias
      '@core': path.resolve(__dirname, '../core'),
      '@modules': path.resolve(__dirname, '../modules'),
      '@web': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../dist/web',
    emptyOutDir: true
  }
})
