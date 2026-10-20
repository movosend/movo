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

**Carga y sidebar.** Toda pantalla nueva lleva un `loading.tsx` que renderiza
`AdminShell` sin `fullName` (modo carga, mismo marco que la real) con composites de
`components/skeletons.tsx` (`PageHeaderSkeleton`, `ListSkeleton`, `CardGridSkeleton`,
envueltos en `PageSkeleton`); la primitiva `Skeleton`/`SkeletonGroup` está en
`components/ui/skeleton.tsx` (shimmer `.mv-skeleton`, respeta `prefers-reduced-motion`).
El sidebar colapsa a íconos (`collapsible="icon"`, Ctrl/⌘+B); su estado vive en la cookie
`sidebar_state` y cada página lo lee con `sidebarDefaultOpen()` (`lib/sidebar.ts`) para
no parpadear al cargar.

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

## MOVO-292 — Pantalla "Admins"

`app/admins` (página + Server Actions `grantAdmin`/`revokeAdmin`) y `components/admins-manager.tsx`:
lista con nombre, email y desde cuándo, alta por email y revocación con motivo y confirmación en línea
(no hay componente de diálogo en `components/ui`). El admin logueado no ve "Revocar" sobre sí mismo
(`AdminProfile.id`), y la acción lo rechaza antes de llamar al gateway aunque igual lo corta svc-admin.
`gateway()` suma `method` (DELETE con body) y `publicError` mapea por código los rechazos de svc-users
a un texto propio (no reenvía el texto del servidor). `requireAdmin(mutable, returnTo)` y
`internalReturnPath` aceptan `/admins` además de `/`; `AdminShell` recibe `current`.
Si `requireAdmin` falla por infraestructura caída, las acciones devuelven el error al formulario en vez de subir al error boundary.

## Rediseño del acceso + login por teléfono

El login (`components/auth-form.tsx`, estilos `.auth-*` en `globals.css`) sigue el prototipo
de Claude Design: paleta neutra y grilla, con los tokens de shadcn remapeados **solo dentro de
`.auth-canvas`** (el resto del panel conserva la paleta actual hasta que se rediseñe). Pestañas
Email / Teléfono (con 🇦🇷 +54 fijo) sobre un campo `identifier`; la pestaña viaja como `method` y
`parseIdentifier` en `app/login/actions.ts` valida según ella. El backend (`/auth/admin/login`) acepta `email` o `phone` y el OTP
sale siempre al email de la cuenta; ahora devuelve `maskedEmail`, que es lo que muestra `/verify`.

## Recuperar contraseña

`/forgot` → `/forgot/code` → `/forgot/new` (`app/forgot/actions.ts`, `components/forgot-form.tsx`)
reusa los endpoints públicos de la app (`/auth/forgot-password`, `/verify-reset-otp`,
`/reset-password`; el código sale por SMS o email según la pestaña). El `otpId` y luego el
`passwordResetToken` viven en la cookie sellada `__Host-movo-reset`, nunca en el cliente. Al
terminar se vuelve a `/login?reset=1`; el backend cierra todas las sesiones (app y panel).
Es el reset de la cuenta de Movo, no algo propio del panel: funciona para cualquier usuario.

## Estética del prototipo y alta de admins con doble verificación

Todo el panel usa la paleta neutra del prototipo de Claude Design (`Movo Admin.dc.html`): tokens en
`app/globals.css`, claro `#F8F8FA`/`#FFFFFF` y oscuro `#0A0A0B`/`#111113`, sin tintes verdes (el dark
anterior no existía en el sistema de Movo). El lima solo acentúa (barra del ítem activo, "Vos", puntos
de estado). Shell con breadcrumb y menú de cuenta (tema, cerrar sesión), Inicio con tarjeta halftone y
secciones "Próximamente", Admins en tabla con diálogos (`components/ui/dialog.tsx`).

Alta de admin en 3 pasos (`AddFlow` en `components/admins-manager.tsx`): autocompletado por nombre o email
(`searchCandidates` → `GET /admin/admins/candidates`, que sí devuelve el email, a diferencia de
`/users/search`), contraseña del admin que otorga y código por email. Los pasos 2 y 3 reusan
`/auth/admin/login` + `/auth/admin/verify` con el email del propio admin; la sesión que emite esa
verificación se cierra enseguida (es solo prueba de identidad). El destino del rol viaja en la cookie
sellada `__Host-movo-grant`, atada al id del admin, nunca en el formulario del paso 3. Limitación
aceptada: la exigencia vive en el BFF; quien llame al gateway con un access token robado no pasa por
ella (los tokens no llegan al navegador). Endurecerlo en `svc-admin` queda fuera de alcance.
Pendiente: confirmar contra dev (sin acceso desde esta sesión) y revisar visualmente claro/oscuro.

## MOVO-295 — Usuarios: buscador y ficha

`/users` (buscador único por nombre, email, teléfono o DNI, 10 por página, `q`/`page` en la URL) y
`/users/[id]` (ficha), fieles al prototipo de Claude Design (`Movo Admin Usuarios.dc.html`). Contratos en
`shared/movo-shared/src/types/admin-users.ts` (se importan por `@movo/shared/src/types/...`); los define este
ticket y los implementa MOVO-294, que los tiene anexados en su descripción.

- **Carga por sección**: la página solo bloquea con `GET /admin/users/:id` (cabecera, banner); cada sección es un
  Server Component dentro de su `<Suspense>` que llama a su propia ruta (`lib/users/load.ts`, que no lanza: devuelve
  `{ ok: false, status }`), así salen en paralelo y un servicio caído solo rompe la suya (`SectionError`, "Reintentar"
  = `router.refresh()`). Reportes y Bloqueos comparten `/moderation` (`loadModeration`, cacheado por render).
  No se usaron Server Actions para cargar: Next las ejecuta en serie. Sí para cambiar de pestaña/página en
  Actividad y Calificaciones (`app/users/[id]/actions.ts`), que piden solo esa página.
- **Estado compartido** (`components/users/ficha-status.tsx`): cada sección publica `loading/ready/error`, su conteo y
  su KPI con `ReportSection`; de ahí leen el índice lateral con scroll-spy (`ficha-index.tsx`) y la tira de KPIs.
- **Modo fixtures**: `MOVO_ADMIN_MOCK=1` (nunca en producción) cambia solo `lib/users/api.ts` por `lib/users/mock.ts` +
  `fixtures.ts` (los usuarios del prototipo). `MOVO_ADMIN_MOCK_FAIL=kyc,ledger` inyecta 502 por sección y
  `MOVO_ADMIN_MOCK_LATENCY_MS` la demora. Para pasar a datos reales alcanza con apagar el flag cuando 294 esté en dev.
- **Fuera del prototipo, agregado por los AC de 293**: Bitácora, tarjeta de Mercado Pago dentro de KYC y pestaña
  Viajes en Actividad. Los envíos no tienen código propio: se muestra el ID corto y, cuando exista MOVO-33,
  `shipmentHref()` en `activity-panel.tsx` es el único lugar a completar para linkear al detalle.
- **Acciones sobre la cuenta**: el botón "Acciones" queda deshabilitado (lugar reservado para MOVO-36).
- Tokens nuevos en `globals.css` (`--success-soft`, `--dot-*`, `--star`, `--shadow-1`, `.mv-grid-fade`, `.mv-dots-fade`).
- `internalReturnPath` acepta ahora `/users[?query]` y `/users/<uuid>`.

Pendiente: verificar a mano contra dev con un usuario con envíos, reportes y bloqueos (DoD de 295), que necesita
MOVO-294 desplegado; hasta entonces la comparación visual con el prototipo se hace con `MOVO_ADMIN_MOCK=1`.
