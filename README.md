# Bar-Kmilo

Sistema privado de administración del bar: ventas por mesa y en barra, inventario, caja, compras y finanzas.
React + TypeScript + Vite + Tailwind + shadcn/ui + Firebase (Auth + Firestore). Despliegue en Render Static Site.

La documentación funcional y técnica está en `../docs/` y el tablero de tareas en `../Progreso/KANBAN.md`.

## Requisitos

- Node.js 22 o superior
- Java 21 o superior (solo para los emuladores de Firebase)

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # por defecto usa emuladores
npm run dev:emulators        # terminal 1: Auth + Firestore locales (UI en http://127.0.0.1:4000)
npm run dev                  # terminal 2: app en http://localhost:5173
```

## Scripts

| Script                            | Qué hace                                 |
| --------------------------------- | ---------------------------------------- |
| `npm run dev`                     | Servidor de desarrollo                   |
| `npm run build`                   | Compilación de producción (`dist/`)      |
| `npm run typecheck`               | Verificación de tipos                    |
| `npm run lint`                    | oxlint                                   |
| `npm run format` / `format:check` | Prettier                                 |
| `npm test`                        | Pruebas unitarias (Vitest)               |
| `npm run test:rules`              | Pruebas de Security Rules en el emulador |
| `npm run check`                   | Tipos + lint + formato + pruebas         |

## Estructura

```
src/
  app/          router, layouts, guards (Fase 1)
  features/     un módulo por funcionalidad (components, hooks, services, domain, schemas)
  domain/       lógica pura compartida: money.ts, dates.ts, metrics/
  lib/firebase/ inicialización y helpers
  components/   ui/ (shadcn) y shared/
  config/       constantes fijas del negocio
tests/rules/    pruebas de firestore.rules
```

## Seguridad

- La configuración web de Firebase es pública; la protección real son las Security Rules.
- Nunca se suben `.env.local` ni cuentas de servicio (están en `.gitignore`).
