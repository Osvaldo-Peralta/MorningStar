# Contrato — `@morningstar/<modulo>`

> Plantilla: copiar este archivo a `docs/contracts/<modulo>.md` al crear un
> módulo nuevo (checklist en ADR-0002 §6). Rellenar todas las secciones;
> borrar las que no apliquen indicando "N/A".

- Estabilidad: **Experimental** <!-- Experimental | Stable | Frozen -->
- Versión del paquete: 0.0.0
- Dueño de prefijos de eventos: `<dominio>:` <!-- registrar en README.md -->
- Dependencias: `@morningstar/core` <!-- + otras solo si un ADR lo justifica -->

<Resumen de 2-4 líneas: qué problema resuelve el módulo y qué NO es.>

---

## 1. API pública — `<NombreDelModulo>`

```ts
export class <NombreDelModulo> implements AppModule {
  readonly id = '<modulo-id>'
  readonly version: string
  state: ModuleState
  // métodos públicos con firmas exactas
}
```

| Método | Precondiciones | Comportamiento | Errores |
|---|---|---|---|
| `<metodo>` | <estado/validaciones> | <efectos: dominio → persistencia → eventos> | <tipos y mensajes> |

<!-- Invariantes adicionales del agregado/dominio si las hay -->

## 2. Dominio

<Entidades, agregados y tipos exportados. Indicar qué es interno aunque se
exporte para tests.>

## 3. Eventos emitidos (ADR-0001, prefijo `<dominio>:`)

| Evento | Cuándo | Payload | Versión |
|---|---|---|---|
| `<dominio>:<accion>` | <condición exacta> | `{ ... }` | v1 |

<!-- Registrar la augmentation de CoreEventMap y su archivo -->

## 4. Eventos consumidos

| Evento | De qué módulo | Reacción |
|---|---|---|
| — | — | — |

## 5. Persistencia

| Clave | Contenido | Escritura |
|---|---|---|
| `<modulo>:<recurso>` | <tipo> | <cuándo> |

<!-- Limitaciones conocidas de durabilidad/identidad -->

## 6. Permisos y configuración

- Permisos que solicita (`Permissions`): <lista o N/A>
- Claves de `CoreConfig` que afectan comportamiento: <lista o N/A>

## 7. Deuda conocida

<Decisiones temporales y su plan de resolución (fase del roadmap).>
