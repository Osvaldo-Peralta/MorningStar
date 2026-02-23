# MorningStar
La base solida de una aplicación muy poderosa
## Ejecución
- Comando para compilar el proyecto
```bash
tsc bootstrap.ts
```
Nota: Es posible que primero necesites instalar `tsc`
---
- Comando para ejecutar `boostrap` (en el backend)
```bash
node bootstrap.js
```

---

## Comandos basicos para verificar la integridad del sistema
```bash
# Comandos para ejecutar en el backend
npm run clean               # Limpiar compilación (si existe)
npm run build               # Para compilar el proyecto
npm run dev                 # Modo desarrollador (para tests, watch interactivo)

# Comandos para ejecutar en el frontend
npm run web:dev             # Inicializar el frontend
npm run web:build           # Compilar el frontend
npm run web:preview

# Modo normal (CI Limpio)
npm test                    # Ejecuta los tests una sola vez
```