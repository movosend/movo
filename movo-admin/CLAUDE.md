# Movo Admin

Panel en Next.js 16, React 19, Tailwind 4 y shadcn Base UI (`base-nova`, Lucide).
Leer `AGENTS.md` y las guías instaladas de Next antes de cambiar routing o autenticación.

## Estado actual de la implementación

MOVO-291 implementa login con email y contraseña, OTP por email, reenvío y sesión
protegida en un BFF. Inicio saluda al administrador real; las secciones futuras están
deshabilitadas y no se muestran estadísticas ficticias. El tema claro/oscuro usa Inter
local, logos existentes y tokens semánticos en `app/globals.css`.
La aceptación contra dev queda pendiente de desplegar las dependencias backend y
configurar las variables de entorno; el deploy de `admin.movosend.app` lo hace GitHub
mediante la integración existente de Vercel. No se provisiona otro proyecto.

## Estructura y seguridad

- `app/login`, `app/verify`: páginas y Server Actions. Solo se serializan estados de
  formulario, email enmascarado y fecha de reenvío. La contraseña nunca se conserva.
- `lib/auth/api.ts`: única salida al gateway, `server-only`, `no-store`, timeout,
  `ApiError` compartido y propagación de `x-request-id`. Se importa el módulo fuente
  `@movo/shared/src/errors/api-error` para no incluir el barrel de JWT ni requerir un
  build previo de shared en Vercel. `next` transpila el paquete; se usa webpack porque
  Turbopack rechaza el módulo TypeScript ESM dentro del paquete CommonJS compartido.
- `lib/auth/session.ts`: cookies `__Host-*`, host-only, httpOnly, Secure, Lax,
  path `/`; access acotado al TTL y refresh al vencimiento absoluto de 8 horas.
  Desafío OTP cifrado y autenticado con AES-256-GCM, máximo 10 minutos; se elimina al
  completar o abandonar el flujo. Nunca retornar tokens a componentes cliente.
- `proxy.ts`: filtro inicial de presencia de cookies. Cada operación debe llamar a
  `requireAdmin()`: consulta perfil actual y `/admin/session` para comprobar también
  la autorización de panel en el gateway. La presencia de una cookie no autentica.
- Server Components derivan a `/auth/refresh` para poder escribir cookies. Acciones
  usan `requireAdmin(true)`. Se renueva y reintenta una sola vez; rechazo limpia
  cookies y muestra «Tu sesión venció. Volvé a iniciar sesión». Infraestructura caída
  conserva cookies y permite reintentar. Destinos de retorno usan una lista interna.
- Las Server Actions exigen un Origin igual a `MOVO_APP_ORIGIN`; el handler de refresh
  rechaza solicitudes de otros sitios (`Sec-Fetch-Site`/`Origin`). Las cookies son Lax
  (no Strict) para que un link externo al panel conserve la sesión; los POST cross-site
  no las llevan y las Server Actions validan el Origin. No poner tokens en URLs, HTML, React payloads, logs ni almacenamiento JS.
- `components/ui`: componentes oficiales; adaptar variantes compartidas, nunca
  colores particulares por pantalla. `globals.css` centraliza superficies, lima,
  advertencias y patrón. Header 56px, sidebar 240px y menú móvil accesible.

## Configuración y despliegue automático

En el proyecto existente de Vercel, usar Root Directory `movo-admin`, Node **22.x**,
Build Command `npm run build` y **Include source files outside of the Root Directory**
para resolver `../shared/movo-shared`. Conservar la integración y dominios existentes.
Configurar para el entorno dev, sin modificar producción:

| Variable | Valor |
| --- | --- |
| `MOVO_GATEWAY_URL` | `https://api-dev.movosend.app` (sin `/api/v1`) |
| `MOVO_APP_ORIGIN` | `https://admin.movosend.app` o el origen HTTPS exacto del preview |
| `MOVO_SESSION_SECRET` | Secreto generado con `openssl rand -hex 32`, exclusivo del servidor |

No agregar prefijo `NEXT_PUBLIC_`. Mantener el secreto estable entre instancias del
mismo entorno: cifra el desafío y deriva por HMAC la clave idempotente del refresh.
Cambiarlo invalida desafíos pendientes y modifica la clave de refresh; coordinar su
rotación. El backend acepta `Idempotency-Key` desde MOVO-291: primero desplegar
`svc-users` y `svc-admin` (más las PRs del stack), después aceptar el frontend.

Para desarrollo: copiar `.env.example` a `.env.local`, configurar un secreto y
`MOVO_APP_ORIGIN=https://localhost:3000`, ejecutar `npm run dev:https` con Node 22.
Si el gateway ocupa 3000, usar `npm run dev:https -- --port 3100` y actualizar el origen.
No desactivar Secure en local. Para certificado propio, pasar las opciones
`--experimental-https-key` y `--experimental-https-cert` de Next.

## Verificación

`npm run lint`, `npm run typecheck`, `npm test`, `npm run build` con Node 22.
Los tests de BFF comprueban atributos de cookies, expiración, origen, refresh, errores,
OTP y ausencia de secretos en estados de acciones. Componentes usan Testing Library.
Las pruebas de concurrencia real pertenecen a `svc-users` y requieren Redis/Postgres.
La prueba contra dev debe cubrir login → OTP → inicio → refresh en dos pestañas →
logout, además de ambos temas, móvil, teclado y ausencia de tokens en payloads.

La tabla de aceptación y evidencia local de MOVO-291 está en
`docs/auth/movo-291-verification.md`; no reemplaza la aceptación pendiente contra dev.
