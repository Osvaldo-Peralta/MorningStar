# MorningStar

[![CI](https://github.com/Osvaldo-Peralta/MorningStar/actions/workflows/ci.yml/badge.svg)](https://github.com/Osvaldo-Peralta/MorningStar/actions/workflows/ci.yml)

La base solida de una aplicación muy poderosa

## Requisitos
- Node.js >= 20 (ESM nativo)
- npm (el repositorio usa *npm workspaces*)

## Ejecución

```bash
# Instalar dependencias (una sola vez)
npm install
```

### Backend (demo en Node)
```bash
npm run bootstrap       # Compila (tsc -b) y ejecuta node dist/bootstrap.js
```

Si quieres compilar y ejecutar por separado:
```bash
npm run build           # Compila paquetes + bootstrap con Project References
node dist/bootstrap.js  # Ejecuta el bootstrap compilado
```

### Frontend
```bash
npm run web:dev         # Servidor de desarrollo (Vite)
npm run web:build       # Compilar el frontend para producción
npm run web:preview     # Previsualizar el build del frontend
```

### Tests y limpieza
```bash
npm test                # Ejecuta los tests una sola vez (Vitest)
npm run dev             # Modo desarrollador (watch interactivo)
npm run clean           # Elimina todos los artefactos de compilación
```

## Estructura del monorepo
```
packages/
  core/                 # ModuleRegistry, lifecycle, EventBus, CoreContext,
                        # puertos (Storage, Persistence, Permission, Logger)
                        # y adaptadores + utilidades de test (core/testing)
  photo-feed/           # Módulo de dominio: fotos (agregar, editar, eliminar)
  identity/             # Módulo de dominio: usuarios, estados y tipos de cuenta (Fase 3)
  authentication/       # Módulo de dominio: credenciales, sesiones, refresh, MFA (Fase 4)
  authorization/        # Módulo de dominio: roles, permisos y evaluación ALLOW/DENY/CONDITIONAL (Fase 5)
  runtime-logger/       # Módulo pasivo de logging basado en eventos
  persistence-node/     # Adaptadores de persistencia y medios para Node
apps/
  web/                  # Frontend React + Vite + Tailwind
bootstrap.ts            # Punto de entrada del backend (Node ESM)
docs/
  contracts/            # Contratos públicos por paquete
  adr/                  # Decisiones de arquitectura (ADR-0001…)
```

Cada paquete se compila de forma independiente (`composite` + Project
References) y expone su contrato público mediante el campo `exports` de su
`package.json`. Los módulos solo deben consumirse a través de su API pública
(`@morningstar/<paquete>`), nunca mediante rutas internas.
