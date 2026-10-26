# WMS Palmerola

Sistema de gestion de almacen (WMS) para la nueva bodega: recepcion guiada, asignacion de
ubicacion, surtido por tabulado e indicadores de operacion.

Stack: **Next.js 16 (App Router) · TypeScript strict · Tailwind 4 · Supabase · Vercel**

## Requisitos

- Node 22 o superior
- Docker Desktop (opcional, para levantar el entorno en contenedor)

## Puesta en marcha

```bash
cp .env.example .env.local
git config core.hooksPath .githooks
npm ci
npm run dev
```

Los valores de `.env.local` se sacan del panel de Supabase, en *Project Settings → API*.
**`.env.local` no se commitea nunca.**

### Con Docker

```bash
docker compose up
```

Levanta la aplicacion en `http://localhost:3000` con recarga en caliente. Necesita `.env.local`.

## Comandos

| Comando | Para que |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de produccion |
| `npm run typecheck` | Comprobacion de tipos |
| `npm run lint` | ESLint |

## Estructura

```
app/            rutas (App Router) y handlers de API
components/     ui/ piezas reutilizables · <dominio>/ componentes con logica
lib/
  supabase/     clientes de servidor y de navegador
  env.ts        validacion de variables de entorno
  errors.ts     errores tipados y respuesta segura
middleware.ts   refresco de sesion y validacion de origen
supabase/       migraciones del esquema
```

## Comprobacion rapida

`GET /api/health` responde si la aplicacion alcanza Supabase.

## Antes de abrir un Pull Request

```bash
npm run typecheck && npm run lint && npm run build
```

Las reglas del equipo estan en `ORG-D-OP/estandares`; las particularidades de este proyecto,
en `CLAUDE.md`.
