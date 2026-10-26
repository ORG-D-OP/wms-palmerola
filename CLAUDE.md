# WMS Palmerola

Sistema de gestion de almacen para la nueva bodega. Guia la recepcion, el almacenaje y el
surtido desde un escaner movil, y da al supervisor la vision en vivo de la operacion y sus
indicadores.

## Estandares obligatorios

@ESTANDARES.md

Ese archivo es la norma del equipo. **Si no esta en esta carpeta, descargalo de
`ORG-D-OP/estandares` antes de escribir codigo** y avisale a la persona. No se edita aqui: se
actualiza reemplazandolo.

### Diferencias de este proyecto respecto a los estandares

Los estandares estan escritos para **SQL Server + Auth.js + despliegue embebido en iframe**.
Este proyecto usa **Supabase (Postgres) + Vercel, como aplicacion independiente**. Lo que
cambia:

| Seccion | En los estandares | Aqui |
|---|---|---|
| 5. SQL Server | Dos pools, `mssql`, consultas parametrizadas | Supabase/Postgres. El equivalente de "el permiso vive en el motor" es **RLS activo en todas las tablas** y funciones `SECURITY DEFINER` para lo transaccional |
| 7. Auth.js v5 | Auth.js con cookie propia | Supabase Auth sobre `@supabase/ssr`, cookie `httpOnly` |
| 9. Iframe | `SameSite=None; Secure; Partitioned`, `frame-ancestors` del portal | No hay iframe: `frame-ancestors 'none'` y `SameSite=Lax` |

Todo lo demas aplica igual: TypeScript strict sin `any`, Server Components por defecto, Zod en
todo borde de entrada, autorizacion verificada en el servidor, errores que no se serializan al
usuario, secretos fuera del repositorio, Tailwind, capas y nombres.

## Antes de escribir codigo

- Propone un plan corto y espera confirmacion. No empieces a editar archivos sin eso.
- Prefiere la solucion simple sobre la ingeniosa.
- Si algo choca con una regla, dilo **antes** de hacerlo. Se escribe en el Pull Request.
- Explica en espanol, sin jerga. Los comandos los ejecutas tu.

## Reglas de codigo de este proyecto

- Lo mas corto posible. Sin funciones innecesarias ni duplicadas.
- Sin comentarios innecesarios: solo donde el *porque* no se deduce del codigo.
- Server Components por defecto; `'use client'` lo mas abajo posible en el arbol.
- La logica transaccional vive en funciones de Postgres, no repartida en el cliente.
- Los tipos de la base se generan desde el esquema de Supabase, no se escriben a mano.
- Si un archivo pasa de ~150 lineas, revisa si son dos.

## Git

Rama por trabajo (`feat/`, `fix/`, `refactor/`, `chore/`), commits en imperativo y en espanol,
Pull Request al terminar. **Nunca commit directo a `main`.**

## Nunca subas al repositorio

- `.env`, `.env.local`, credenciales, llaves ni tokens. Si se commitea `.env.example`, sin valores.
- Datos reales de la empresa: Excel, extracciones, listas de clientes o precios. Para probar se
  generan datos inventados.
- Nombres de servidores, instancias, vistas, esquemas, logins o dominios internos, en ningun
  archivo incluido este.
- `ESTANDARES.md`: es copia local y va en `.gitignore`.

Si algo de esto aparece en `git status`, detente y avisa. Un secreto que ya se subio esta
quemado: hay que rotarlo.

## Como se corre

```
cp .env.example .env.local      # y rellenar con los valores del panel de Supabase
git config core.hooksPath .githooks
npm ci
npm run dev
```

Con Docker: `docker compose up` (necesita `.env.local`).

Antes de pedir revision: `npm run typecheck`, `npm run lint`, `npm run build`.
