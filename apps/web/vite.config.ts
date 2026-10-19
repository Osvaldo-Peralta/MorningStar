import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Los paquetes del monorepo se resuelven por la condición de exports
// `development` (fuente .ts) en dev/build — patrón "just-in-time packages":
// la app bundlea las fuentes directamente; `dist/` solo lo consume el
// runtime Node (bootstrap). Sin aliases ni builds previos necesarios.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    conditions: ['development'],
  },
})
