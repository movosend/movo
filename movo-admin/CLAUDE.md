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
  Viajes en Actividad. Los envíos no tienen código propio: se muestra el ID corto, que linkea al detalle con
  `shipmentHref()` (ver MOVO-326).
- **Listas que crecen**: Actividad (envíos y viajes) y Calificaciones paginan de a 5 con `page`/`total`; Cuenta
  corriente y Bitácora por cursor con "Ver más" (`MoreRow`, acciones `loadLedgerMore`/`loadAuditMore`); Reportes
  pagina de a 5 en el cliente sobre las 50 más recientes que manda `/moderation` (`totals` dice cuántas hay) y
  Bloqueos muestra 6 por columna con "Ver más"; los intentos de KYC colapsan después de 3. Sanciones y
  Dispositivos no paginan: son pocos por persona. En el modo fixtures, Diego Funes trae volumen alto para probarlo.
- **Acciones sobre la cuenta**: ver "Acciones de soporte sobre la cuenta" más abajo. Las sanciones (MOVO-299) siguen
  siendo una entrada deshabilitada del mismo menú.
- Tokens nuevos en `globals.css` (`--success-soft`, `--dot-*`, `--star`, `--shadow-1`, `.mv-grid-fade`, `.mv-dots-fade`).
- `internalReturnPath` acepta ahora `/users[?query]` y `/users/<uuid>`.

Pendiente: verificar a mano contra dev con un usuario con envíos, reportes y bloqueos (DoD de 295), que necesita
MOVO-294 desplegado; hasta entonces la comparación visual con el prototipo se hace con `MOVO_ADMIN_MOCK=1`.

## Acciones de soporte sobre la cuenta (contratos en MOVO-294)

Menú "Acciones" de la cabecera de la ficha (`components/users/actions/account-actions.tsx`): cambiar email, cambiar
teléfono, cerrar todas las sesiones, ajustar el saldo y agregar una nota interna, más "Suspender o inhabilitar"
deshabilitado hasta MOVO-299. Cada una abre un diálogo (`components/users/actions/*-dialog.tsx`) con motivo obligatorio y
se manda por una Server Action (`app/users/[id]/account-actions.ts`) → `lib/users/mutations.ts` → `svc-admin`
(`POST /admin/users/:id/{sessions/revoke,contact,ledger/adjustments,notes}`). Los errores vuelven como dato
(`ActionResult`, `lib/users/errors.ts`) y se muestran dentro del diálogo; al salir bien se hace `revalidatePath` de la ficha.

- **Confirmación en dos pasos** para email/teléfono y saldo: formulario → "antes → después" con la lista de consecuencias y
  un tilde obligatorio (email/teléfono: "cambia cómo entra a su cuenta"; saldo: "el monto y el sentido son correctos").
  El valor que el admin vio viaja como `expectedCurrent`; si cambió, `CONTACT_CHANGED` y el diálogo solo deja cerrar.
- **Saldo**: el diálogo lee el saldo de la sección Cuenta corriente (`balanceArs` que publica `ReportSection` en
  `ficha-status.tsx`) y no deja revisar hasta que cargó. La `idempotencyKey` es un UUID por apertura del diálogo; se reusa
  si el servicio no respondió (`unconfirmed`, el ajuste pudo aplicarse) y se renueva ante un rechazo definitivo.
- **Teléfono/email nuevos quedan sin verificar** (un admin no da prueba de propiedad) y se cierran las sesiones: lo hace el
  backend; el panel solo lo avisa antes de confirmar. `normalizeArPhone` (`lib/users/contact.ts`) es solo para validar y
  mostrar "se guarda como": la normalización que vale es la de `svc-users`.
- **Look de los diálogos de plata y de notas**: el ajuste de saldo usa el "hero" del saldo, tarjetas de sentido en
  ámbar/verde (`warn-*`/`success-*`), monto grande con montos rápidos y el antes → después en vivo; al confirmar, un
  comprobante tipo ticket. Las notas son post-its (`.mv-postit`/`.mv-postit-lines` y tokens `--postit-*` en `globals.css`,
  claro y oscuro; `PostitPin` en `actions/postit.tsx`), tanto al escribirlas como en la sección.
- **Notas**: sección nueva "Notas" (`notes-section.tsx`/`notes-panel.tsx`, por cursor con "Ver más"); solo se agregan.
  Las secciones Cuenta corriente, Bitácora y Notas se recrean con `key` cuando entra un movimiento/fila/nota nueva, si no
  conservarían la lista en su estado.
- **Propia cuenta y cuenta eliminada**: el menú deshabilita todo sobre la propia cuenta (`isSelf`, igual lo corta
  `ADMIN_CONFLICT_OF_INTEREST`) y deja solo notas en una cuenta `deleted` (`USER_DELETED` en el resto).
- **Modo fixtures**: las acciones funcionan en memoria (`mock.ts`: perfil, cuenta corriente, notas y bitácora cambian de
  verdad hasta reiniciar el server). `MOVO_ADMIN_MOCK_FAIL=actions!` las hace fallar con 502 ("Sin confirmar").

Pendiente: probarlo a mano contra dev y en claro/oscuro (esta sesión no tuvo acceso al login real); contra el backend real
falta MOVO-294. Códigos nuevos en `ApiErrorCode`: `CONTACT_CHANGED`, `CONTACT_UNCHANGED`, `USER_DELETED`, `AMOUNT_OUT_OF_RANGE`.

## MOVO-323 — Soporte: bandeja del agente

`/support` (lista) y `/support/[id]` (conversación), fieles al prototipo de Claude Design (`Movo Admin Soporte.dc.html`).
Contratos en `shared/movo-shared/src/types/admin-support.ts` y `docs/support/README.md`; los define este ticket y los implementan
MOVO-322 (API) y MOVO-321 (adjuntos), que los tienen anexados en su descripción.

- **Filtros en la URL** (`?status=&owner=&q=`, default Abiertos/Todos); `app/support/layout.tsx` monta el shell y la lista (client,
  `ConversationList`) y se queda al navegar entre conversaciones. La lista pide `list` + `counts` al backend (orden y filtros los resuelve
  él). Bajo 1200 px la barra lateral pasa a íconos (`InboxFrame`); el contexto es una columna desde 1360 px y un `Sheet` antes; bajo 768 px
  se ve una columna a la vez.
- **Lecturas del navegador** por un Route Handler (`app/api/support/[resource]`, `lib/support/client.ts`), no por Server Actions (Next las
  ejecuta de a una). **Escrituras** por Server Actions (`app/support/actions.ts`) con UI optimista: el mensaje sale con `clientMessageId` y, si
  falla, queda "No se envió" con Reintentar (mismo id, así no se duplica). `gateway()` suma `PATCH`.
- **Tiempo real** (`lib/support/realtime/feed.ts`, `components/support/support-provider.tsx`): una conexión por pestaña para todo el panel,
  pedida por `AdminShell`. WS con ticket de un solo uso (Server Action `requestRealtimeTicket`, subprotocolo `movo-support.v1`), reconexión con
  backoff y jitter, y polling de respaldo tras 3 fallos; al recuperar la conexión emite `resync` y lista/conversación se vuelven a pedir.
  Alimenta el badge del menú y los toasts "Nueva consulta de …". **El WS real no existe todavía** (MOVO-322): con el mock, `mock://support`
  simula el socket leyendo `/api/support/events`.
- **Conflicto de interés**: una consulta cuyo usuario es el admin se abre ya bloqueada; un `403 ADMIN_CONFLICT_OF_INTEREST` al enviar o
  modificar hace lo mismo. Sin calificación de la atención (se omitió la tarjeta de estrellas del prototipo).
- **Fuera del prototipo, agregado por los AC**: adjuntos (selector, arrastrar, pegar, vista previa, lightbox), menú de tema, estados de
  carga y error, reconexión. Los links a envíos pasan por `shipmentHref()` (`lib/support/shipment-href.ts`), que desde MOVO-326
  apunta a `/shipments/:id`. Los menús usan `MenuHeading` y no `DropdownMenuLabel` (Base UI exige un grupo padre).
- **Modo fixtures** (`MOVO_ADMIN_MOCK=1`): `lib/support/{mock,fixtures}.ts` portan las 9 consultas del prototipo, la que entra sola a los
  16 s, respuestas del usuario y una consulta propia del admin logueado. `MOVO_ADMIN_MOCK_FAIL=context,list,send!,ws…`,
  `MOVO_ADMIN_MOCK_SIMULATE=0`. Los adjuntos se suben a `/api/support/mock-upload/[id]` y se leen de `mock-image/[id]`.
- **Columnas redimensionables y colapsables**: la lista (260–480 px) y la ficha del usuario (280–480 px) se arrastran por su borde
  (`ResizeHandle`, patrón *window splitter*: ←/→ de a 16 px, Shift 48, Inicio/Fin, Enter colapsa, doble clic restablece) y se ocultan por
  completo (botón en la lista, y en el encabezado de la conversación para la ficha; si la lista está oculta, el botón para reabrirla vive
  en el encabezado y en el estado vacío). El estado va en la cookie `support_panels` (`lib/support/panels.ts`, leída en
  `app/support/layout.tsx`) para que el servidor dibuje el ancho correcto sin parpadeo; `PanelProvider` está en `panel-layout.tsx`. Bajo
  1360 px la ficha sigue siendo un `Sheet`, y bajo 768 px no hay arrastre.

Pendiente: probar contra dev con 321/322 desplegados (DoD pide un screenshot contra backend real) y revisar a mano en claro/oscuro:
esta sesión verificó con tests, lint, typecheck y build, pero no abrió el panel (el login real necesita el gateway).

## MOVO-326 — Envíos: listado y detalle en solo lectura

`/shipments` y `/shipments/[id]`, fieles al prototipo `Movo Admin Envios.dc.html` sin la vista "En vivo" ni el modal de
cambio de estado (MOVO-333). Contrato de MOVO-325 (`shared/movo-shared/src/types/admin-shipments.ts`), que esta US amplió con
`statusCounts`, `alertCounts` y el filtro `alert` para los chips por estado y el toggle "Solo con alerta".

- **Estado del listado en la URL** (`lib/shipments/params.ts`): pestaña, estado, `q`, ciudad, fechas (días argentinos sobre el
  último cambio de estado), `alert` y la página. El paginado es por cursor: las páginas anteriores viajan en `back`, así
  "Anterior" no le pide nada al servidor. El detalle recibe el listado en `?from=` y lo rearma con `parseListState` para "Volver".
  Recarga manual con la hora de la carga; sin refresco automático.
- **Detalle por bloques**: solo `GET /admin/shipments/:id` bloquea; partes, pago y eventos son `AdminBlock` y cada uno muestra
  su error con "Reintentar" (`BlockError`, `router.refresh()`). El chat se pide aparte dentro de su `<Suspense>` (botón "Ver chat"
  del encabezado) y abre un `Sheet` sin compositor; "Ver mensajes anteriores" usa la Server Action `loadChatPage`.
- **Avisos**: si una fila lleva aviso lo decide `isAdminShipmentAlert` de `@movo/shared` (la regla del filtro del backend);
  `rowAlert` (`lib/shipments/format.ts`) solo elige el texto. El badge de "Solo con alerta" se oculta con un chip de estado
  elegido: `alertCounts` es por pestaña. El handshake ("Retiro confirmado con QR · 09:24") sale del
  evento `→ in_transit`/`→ delivered`. "Marcado por el equipo, sin QR" y las marcas Forzado/Manual esperan a que los eventos
  traigan la marca de admin (MOVO-333). El mapa de seguimiento es MOVO-328 (ver abajo).
- **Ruta por ciudad, no por barrio** (el prototipo muestra barrios): el backend solo guarda la ciudad (`pickupCity`/`deliveryCity`)
  y el barrio no es un dato aparte. Mostrarlo pediría columnas nuevas, sacarlo del geocoding y un backfill; se decidió no hacerlo.
  Las calles van en la segunda línea desde 1320 px. Ese corte se escribe en rem (`min-[82.5rem]`): Tailwind no ordena un
  `min-[…px]` contra `md` (rem) y el `md:` le ganaba a la grilla de 6 columnas.
- **Código del envío**: `shipmentDisplayCode(id)` (`lib/shipments/format.ts`) = `#MOVO-` + últimos 5 dígitos del id, igual que `activeShipmentDisplayCode` de la app. Solo para mostrar: el `code` del contrato (8 hex) ya no se dibuja y la búsqueda del listado sigue por id. El aviso de fila va dentro de la celda Ruta, no en una franja aparte.
- `shipmentHref()` (`lib/support/shipment-href.ts`) ya linkea al detalle, también desde Actividad de la ficha de usuario.
- **Modo fixtures**: `MOVO_ADMIN_MOCK=1` usa `lib/shipments/{mock,fixtures}.ts` (los envíos del prototipo más 40 cerrados para
  paginar). `MOVO_ADMIN_MOCK_FAIL=list,events,payment,parties,chat` (con `!` falla siempre).

Pendiente: screenshots contra dev (DoD) y revisión a mano en claro/oscuro; necesita desplegados MOVO-325 y la ampliación de
`svc-shipments`/`svc-admin` de esta misma PR.

## MOVO-328 — Mapa de seguimiento del envío

`<ShipmentTrackingMap shipmentId />` (`components/shipments/tracking/tracking-panel.tsx`) es el bloque de seguimiento del detalle de
envíos (MOVO-33, prototipo `Movo Admin Envios.dc.html`). Está montado en `app/shipments/[id]/page.tsx`, en la columna principal, donde
estaba el `TrackingPlaceholder` de MOVO-326 (borrado junto con su `trackingMessage` de `lib/shipments/format.ts`; el copy por estado vive
ahora en `lib/shipments/tracking/copy.ts`).

- **Datos**: `GET /admin/shipments/:id/tracking` (MOVO-327) por `lib/shipments/tracking/api.ts`; el navegador lee por el Route Handler
  `app/api/shipments/[id]/tracking` (mismo patrón que soporte). El contrato es **provisorio** (`lib/shipments/tracking/types.ts`, la forma
  propuesta en el comentario de MOVO-327): cuando `AdminShipmentTracking` exista en `@movo/shared` se borra ese archivo y se importa de ahí.
- **Actualización**: polling (`lib/shipments/tracking/poller.ts`, sin React) cada `pollIntervalSeconds` del backend (15 s por defecto), solo
  mientras el envío está `live`; backoff con jitter si falla (conserva el último dato y muestra "Reconectando…"), pausa con la pestaña oculta
  y retoma al volver. Es lo único del panel que se refresca solo. El WS de tracking no se usa: un navegador no puede mandar `Authorization`.
- **Mapa** (`tracking-map.tsx`, único que toca Leaflet, cargado con `dynamic(ssr:false)`): tramo recorrido = traza real (azul sólido), faltante
  = ruta planificada desde el vértice más cercano a la última posición (punteado), retiro/entrega con etiqueta, transportista con pulso y, con
  `signalLost` o `delayed`, ámbar con "sin señal · hora del último ping". Encuadra la ruta completa una vez por envío; "Seguir al
  transportista" hace `panTo` en cada actualización. La rueda del mouse no hace zoom (hace scroll de la página).
- **Estados sin seguimiento en vivo** (`copy.ts`): el mapa se dibuja siempre, como en el prototipo, con retiro/entrega y la ruta original
  completa (punteada); si hay traza (cerrado/disputa) se suma como tramo recorrido. Debajo, en lugar de las métricas, el mensaje:
  "Todavía no arrancó", "Seguimiento cerrado", "Seguimiento cortado", "Sin seguimiento" (+ "La traza GPS ya fue purgada.").
- **Teselas**: ArcGIS Location Platform (gris claro/oscuro, `lib/shipments/tracking/tiles.ts`) con `NEXT_PUBLIC_ESRI_API_KEY`, restringida por
  referrer; reemplaza al `server.arcgisonline.com` público del prototipo, cuyos términos no cubren un panel productivo (AC8). Sin key el
  mapa se dibuja sin teselas. **Pendiente**: crear la key y cargarla en Vercel (dev y prod).
- **Modo fixtures** (`MOVO_ADMIN_MOCK=1`): ocho envíos de prueba (ids propios, no coinciden con los del listado de MOVO-326, así que en el detalle mock el mapa muestra el error 404), `00000000-0000-4000-8000-00000000000{1..8}` (`MOCK_TRACKING_IDS`: en camino,
  sin señal, sin arrancar, sin fondos, entregado, disputa, sin transportista, traza purgada); el que está en camino se mueve entre lecturas.
- **Tokens nuevos** en `globals.css`: `--map-bg`, `--glass`, `--track-done`, `--track-todo` y las clases `.mv-track-*`.

Pendiente: captura contra un envío real en dev (DoD), que necesita MOVO-327 desplegado; la etiqueta de retiro/entrega es el "barrio" del
prototipo solo si el backend lo resuelve (hoy el modelo tiene ciudad y dirección).
