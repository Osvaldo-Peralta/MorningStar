# MorningStar
La base solida de una aplicación muy poderosa
## Ejecución
- Comando para compilar el proyecto
```bash
tsc bootstrap.ts
```
Nota: Es posible que primero necesites instalar `tsc`
---
- Comando para ejecutar `boostrap`
```bash
node bootstrap.js
```

---

## Comandos basicos para verificar la integridad del sistema
```bash
npm run clean       # Limpiar compilación (si existe)
npm run build       # Para compilar el proyecto
npm run dev         # Modo desarrollador (para tests, watch interactivo)

# Modo normal (CI Limpio)
npm test            # Ejecuta los tests una sola vez
```