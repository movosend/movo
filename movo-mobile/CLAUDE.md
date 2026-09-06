@AGENTS.md

# Estado de implementación — movo-mobile

Ver el `CLAUDE.md` de la raíz del repo para contexto general del proyecto (stack,
ADRs, convenciones, git/PR). Entrada corta por US: qué se hizo, en qué archivos,
decisiones no obvias, qué queda pendiente.

## Estado actual de la implementación

### MOVO-73 — Onboarding en `movo-mobile`: registro, OTP, mapa, KYC embebido, dark mode

Wizard de 7 pasos (`app/(auth)/register.tsx`): datos básicos → DNI → dirección → mapa
(geocoding) → OTP → contraseña → revisión. KYC vía SDK nativo de Didit — import
diferido con `require()` dentro del handler, nunca `import` estático (el SDK rompe
Expo Go si se evalúa al arrancar, porque expo-router evalúa todas las rutas al abrir
la app). Dark mode automático (`darkMode:"class"` en NativeWind — sigue el tema del
SO, sin toggle manual). Tabla `users.address` nueva (una por registro, lat/long vía
`GeocodingProvider` mock/google, ADR-014); endpoint público `POST /geocode` que proxea
la Geocoding API server-side. Keys de Google Maps van en `app.config.js`/EAS env vars,
nunca en `app.json`/`eas.json` (se trackean en git).

Fixes de esta misma US que dejaron el flujo realmente utilizable:
- Resume del onboarding: el redirect a `/kyc` desde `/` no se disparaba porque nadie
  consumía `hasPendingRegistration` — corregido en `app/index.tsx`.
- KYC en `pending` era un pozo sin salida: `createSession` ahora reconcilia contra
  Didit (`getSessionDecision`, pull) antes de expirar el intento previo — evita
  perder un `approved`/`rejected` real por reintentar demasiado rápido.
- `phoneVerificationToken` se libera ante cualquier falla de `create()` (nested write
  atómico de Prisma, seguro liberar siempre), no solo en conflicto de datos.
- `Expired`/`Abandoned`/`Kyc Expired` de Didit mapean a `KycStatus.EXPIRED`
  (reintentable) — sin validar contra sandbox real.

### MOVO-76 — Login, secure storage, refresh automático, guard de navegación (mobile)

`http-client.ts`: interceptor adjunta `Authorization`, refresh single-flight ante 401
(no reintenta si el 401 viene de un `Authorization` explícito del caller — evita
competir con el refresh proactivo y disparar la detección de reuso de MOVO-75).
`auth-store.ts` (Zustand + `expo-secure-store`). El guard de `(app)/_layout.tsx`
reacciona al store solo, sin `router.replace` explícito en logout. `app/index.tsx`
redirige sesión restaurada a `/home` (KYC aprobado) o `/kyc` (resto).

### MOVO-78 — Perfil propio, insignias, logout (mobile)

Tab bar de 3 pestañas. Tipos de wire contract (`PublicProfile`/`PrivateProfile`/
`ProfileBadge`) movidos a `@movo/shared`. Formateo de contadores con guard explícito
contra `null`/`NaN` (nunca `?? 0` ciego — `NaN ?? 0` sigue siendo `NaN`). Separación
pública/privada resuelta por tipos de componente (`ProfilePrivateSection` no acepta
campos de `PublicProfile`), no por flag visual sobre un componente genérico.

### MOVO-83 (parcial) — Rediseño de Inicio y punto de entrada al wizard de envío (`movo-mobile`)

Solo el punto de entrada (AC1): el wizard de creación de envío en sí es un ticket
aparte, todavía sin arrancar. `home.tsx` deja de ser el placeholder de MOVO-76
(saludo + logout) y pasa a `ScrollView` con: saludo + banner KYC (sin cambios),
`HomeSendCta` (CTA primaria con el acento lime de marca, bloqueada hasta KYC de
identidad aprobado) y `RecentShipmentsSection` (vista previa de los últimos 3 envíos
propios vía `GET /shipments/mine`, MOVO-80 backend — ya Done). El botón de logout se
sacó de Inicio (ya vive en Perfil, `ProfileLogoutButton`, MOVO-78).

- **`GradientBorderCard` extraído** de `profile-stats-row.tsx` a
  `components/ui/gradient-border-card.tsx` — mismo lenguaje visual "chrome" reusado
  por `RecentShipmentsSection`, evita duplicar el truco de doble `LinearGradient`.
- **`app/(app)/send.tsx`**: placeholder, sibling de `license-kyc.tsx` (fuera de
  `(tabs)/`, con su propio header — no otro ítem de la tab bar flotante, según AC1).
  Deja la navegación real cableada (`router.push('/send')` desde la CTA) sin inventar
  un destino falso — el wizard real reemplaza este archivo cuando arranque su ticket.
- **`src/api/shipments-client.ts`** (`listMine`) y **`src/hooks/use-shipments.ts`**
  (`useRecentShipments`, TanStack Query, `limit: 3`) nuevos — primer consumo del
  mobile de `GET /shipments/mine`.
- **`src/lib/shipment-format.ts`**: traducción de `ShipmentStatus` a español + tono
  semántico por estado, y formateo de precio (prioriza `agreedPriceArs`, cae a
  `suggestedPriceArs` si todavía no hay acuerdo — nunca "$0").

Pendiente / fuera de alcance: el wizard de creación en sí (pasos de
paquete/direcciones/receptor/confirmación), listado completo de envíos (la home solo
muestra una vista previa de 3), y cross-sell a Transportar desde Inicio (evaluado,
descartado por ahora para no duplicar el tab).

### MOVO-107 — Push notifications: permisos y registro de token (mobile)

Implementado contra el contrato de MOVO-106 (backend, todavía sin implementar).
`device-id.ts` (UUID persistido en secure-store, sobrevive a logout — identifica el
dispositivo, no la sesión). `expo-crypto` en vez del paquete `uuid` (evita el
polyfill de `crypto.getRandomValues` en Hermes). Des-registro en logout, tolera
fallos sin bloquear el logout. `eas.projectId` repuesto en `app.config.js` (se había
perdido al migrar de `app.json` en MOVO-73).

Tests nuevos: `test/device-id.test.ts`, `test/notifications-client.test.ts`,
`test/push-registration.test.ts` (permiso denegado no registra — AC1; permiso
concedido registra — AC2/AC3; `getExpoPushTokenAsync` fallando no rompe — AC7;
de-registro tolera fallos), `test/use-push-notifications.test.tsx` (registro único por
transición a autenticado, re-registro tras logout/login en el mismo dispositivo, tap
de notificación de envío no crashea, cleanup del listener al desmontar), más dos casos
agregados a `test/auth-store.test.tsx` (logout des-registra el dispositivo, y tolera
que falle). 111/111 en `movo-mobile` (subieron de 93). `tsc --noEmit` sin errores. No
hay `eslint.config.js` en `movo-mobile` todavía (paquete sin lint configurado, a
diferencia del resto del monorepo) — no es parte de esta US.

Pendiente / fuera de alcance de MOVO-107: backend real de MOVO-106 (código escrito
contra su contrato, sin poder integrar hasta que exista — con `projectId` ya
configurado, este es ahora el único bloqueo real para probar push de punta a punta),
pantalla de destino real para AC6 (depende de MOVO-83+), y el DoD manual del ticket
(development build en dispositivo físico, casos de prueba con push real) — no
verificable en este entorno.

### MOVO-98 — Paso de foto de perfil al cerrar el onboarding y edición desde el perfil (`movo-mobile`)

Implementado el último paso del onboarding para cargar la foto de perfil (cámara o galería) con recorte 1:1, compresión en cliente y subida directa a S3 vía presigned URL (ADR-007, MOVO-97), reutilizado también desde la pantalla de perfil propio (`app/(app)/(tabs)/profile.tsx`) para cambiar o eliminar la foto.

Archivos nuevos:
- `app/(auth)/profile-photo.tsx`: pantalla de cierre de onboarding con copy explicativo sobre confianza y handshake en Movo (AC2), botón "Continuar", "Más tarde" (AC8) y activación de sesión persistida (AC9).
- `components/profile/photo-picker.tsx`: componente autónomo y reutilizable de selección, vista previa, subida directa, edición y borrado de foto (AC10).
- `src/lib/photo-utils.ts`: utilidades para conversión de URIs locales a `Blob` (`uriToBlob` vía `XMLHttpRequest`), compresión y redimensión en cliente (`prepareProfilePhoto` a máx 1024px, JPEG 0.8 con `expo-image-manipulator` — AC5), y pickers nativos con `expo-image-picker` (`allowsEditing: true`, `aspect: [1, 1]` — AC4).
- `src/api/users-client.ts`: cliente para `getPhotoUploadUrl` (`POST /users/me/photo/upload-url`), `confirmPhoto` (`PUT /users/me/photo`), `deletePhoto` (`DELETE /users/me/photo`) y `uploadPhotoToS3` (PUT directo a S3 sin header Authorization).

Decisiones clave:
- **Subida binaria a S3 en React Native**: `fetch(file://)` en iOS/Hermes falla con URLs locales o multipart. Se implementó `uriToBlob` con `XMLHttpRequest` (`responseType = 'blob'`) y upload directo a S3 con `XMLHttpRequest` PUT pasando el `Blob` y el `Content-Type` exacto de la presigned URL (ADR-007 / AC6).
- **`httpClient` seguro para requests sin body**: se corrigió `doFetch` para que solo adjunte `Content-Type: application/json` si `body !== undefined`. Esto previene el error `400 FST_ERR_CTP_EMPTY_JSON_BODY` de Fastify en peticiones `DELETE` o `GET` con 0 bytes de cuerpo.
- **Transición de KYC y sincronización de estado**: `kyc.tsx` navega a `/profile-photo` únicamente con KYC `approved`; en `manual_review` u otros estados el botón "Ir al inicio" ejecuta `goHome()`. Al montar `profile-photo.tsx`, se activa la sesión persistida en `useAuthStore` para que las peticiones de `PhotoPicker` viajen con el Bearer token válido.
- **Sincronización de KYC aprobado al reabrir la app**: `auth-store.ts` expone `updateKycStatus`, `home.tsx` y `useRegistration` consumen `useMyProfile` para reflejar el estado fresco del backend, y `app/index.tsx` revalida contra `getMyProfile()` antes de mandar a `/kyc` para evitar bucles cuando un usuario es aprobado mientras la app está cerrada.
- `app.config.js`: agregados `NSPhotoLibraryUsageDescription` y `NSCameraUsageDescription` en `infoPlist`, más el plugin `expo-image-picker`.

Tests nuevos y actualizados: `test/photo-utils.test.ts`, `test/users-client.test.ts`, `test/photo-picker.test.tsx`, `test/profile-photo-screen.test.tsx`, `test/kyc.test.tsx`, `test/profile.test.tsx`, `test/http-client.test.tsx`. Total de 19 suites pasadas / 137 tests exitosos en `movo-mobile`. `tsc --noEmit` sin errores.

### MOVO-121 — Pantalla de gestión de direcciones guardadas (Perfil)

Reemplaza el placeholder "Direcciones guardadas" de Perfil → Configuración
(`profile-settings-section.tsx`, MOVO-78) por `app/(app)/addresses.tsx`: listar
(estrella lima para la default), agregar, editar `label`/`isDefault` y borrar (con
confirmación `Alert.alert`, mismo criterio que "¿Descartar este envío?" de `send.tsx`).
Bloqueado por MOVO-119 (backend) y por el wizard de MOVO-83 (de donde se reusa
código) — el ticket arrancó recién cuando el PR de MOVO-83 se mergeó a `develop`.

Decisiones clave:
- **`Address`/`CreateAddressInput`/`UpdateAddressInput` migrados a `@movo/shared`**
  (`src/types/address.ts`, ver `shared/movo-shared/CLAUDE.md`) — antes duplicados a
  mano en `addresses-client.ts` contra un contrato "propuesto" (MOVO-83, escrito
  antes de que MOVO-119 backend existiera) que ya no coincidía del todo con el real
  (`label`/`isDefault` opcionales en el alta, `isDefault` solo acepta `true` en el
  update). Mismo criterio que `PrivateProfile`/`PublicProfile` (MOVO-78).
- **`AddressSearchSheet` desacoplado del wizard para poder reusarlo (AC3)**: tenía dos
  imports directos al dominio del wizard. `AddressSelection`/`AddressSource` se
  movieron de `shipment-wizard-store.ts` a `src/types/address-selection.ts` (tipo
  neutral); `useShipmentAddress()` se renombró a `useMyLocation()`
  (`src/hooks/use-my-location.ts`, método interno `resolveCurrentLocation`) — ya no
  tenía ninguna dependencia real del wizard, solo el import de tipo. Con esto el
  sheet no importa nada del store de Zustand del wizard.
- **AC4 con el alcance mínimo aceptado por el propio ticket**: `edit-address-sheet.tsx`
  solo edita `label`/`isDefault`, sin reabrir el buscador de Places. El toggle de
  default queda deshabilitado si la dirección ya lo es (nunca manda `isDefault:false`,
  el backend lo rechaza con 400).
- **Paso de confirmación entre elegir y guardar (`confirm-add-address-sheet.tsx`,
  fix de feedback post-implementación)**: guardar automáticamente apenas se elegía una
  dirección en `AddressSearchSheet` tenía dos problemas — nunca se mostraba el mapa
  para ajustar el pin, y un error de guardado quedaba oculto detrás del `Modal` del
  buscador (solo visible si el usuario lo cerraba a mano, y aparecía "en la pantalla
  principal" en vez de en el buscador). Ahora `AddressSearchSheet` solo elige
  (`AddressSelection`, sin guardar), y `ConfirmAddAddressSheet` — con
  `CollapsibleMapRow` siempre expandido (`autoExpand`) para ajustar el pin — hace el
  alta real con un botón explícito "Guardar dirección" y muestra el error ahí mismo.
- **`addressSelectionToCreateInput()` (`src/lib/address-selection-to-input.ts`, fix de
  bug) reemplaza el split a mano duplicado en `address-field.tsx` y en la pantalla de
  direcciones**: el split anterior mandaba `streetNumber`/`province`/`postalCode`
  siempre `""`, y `addresses.schema.ts` (`movo-svc-users`) exige `minLength: 1` en esos
  campos — el alta fallaba con 400 en TODOS los casos, no como excepción (bug
  reportado por el usuario). El helper separa el número de calle con una regex
  (`"Av. Colón 1000"` → calle "Av. Colón" + altura "1000") y completa lo que Places no
  puede dar con precisión (`province`/`postalCode`, a veces `city`) con un placeholder
  explícito ("S/D") en vez de string vacío.
- Marcar default también expuesto como acción rápida por fila (tocar la estrella),
  además de dentro del sheet de editar (AC5).
- `edit-address-sheet.tsx` envuelto en `KeyboardAvoidingView` (mismo criterio que
  `address-search-sheet.tsx`) — el teclado tapaba el campo de `label` al editar.
  Subtítulo agregado arriba de la lista explicando qué se puede hacer en la pantalla.
- **`ConfirmAddAddressBody` remontado con `key` derivado de la selección (fix de bug
  de feedback)**: el `Modal` de RN nunca desmonta a sus hijos entre aperturas (solo
  los oculta) — sin este `key`, `MapView#initialRegion` (que solo se lee al montar)
  quedaba congelado en la primera dirección que se había confirmado, así que el mapa
  mostraba siempre esa mientras el usuario elegía direcciones nuevas en pasadas
  posteriores del mismo sheet. Distinto del bug de campos vacíos de más arriba — este
  es sobre el `lat`/`lng` mostrados en el mapa, no sobre lo que se guarda.
- **Mapa a pantalla completa (pedido explícito de diseño)**: `MapView`/`Marker` se
  arman a mano en `ConfirmAddAddressBody` (no `CollapsibleMapRow`, pensado para una
  fila colapsable de alto fijo) — header y card inferior (dirección + "Guardar
  dirección") flotan sobre el mapa con `BlurView`, mismo lenguaje "glassy" que
  `FloatingTabBar` (MOVO-78, `intensity`/`tint`/`blurMethod` por plataforma
  idénticos). Sin `SafeAreaView`: el mapa necesita ocupar el área completa incluidos
  los insets, así que el padding de status bar/home indicator se aplica a mano
  (`insets.top`/`insets.bottom`) en el header y la card inferior respectivamente.

Tests nuevos: `test/addresses-screen.test.tsx` (loading/error/vacío/lista/borrar con
confirmación, elegir dirección abre el paso de confirmación en vez de guardar sola),
`test/edit-address-sheet.test.tsx`, `test/profile-settings-section.test.tsx`
(navegación del ítem real vs. placeholder del resto), `test/confirm-add-address-sheet.test.tsx`
(incluye regresión del mapa congelado entre selecciones),
`test/address-selection-to-input.test.ts` (regresión del bug de campos vacíos).
36/36 suites, 239/239 tests en `movo-mobile`. `tsc --noEmit` limpio.

Pendiente / fuera de alcance: no se tocó el backend (`movo-svc-users`) para que use el
tipo migrado a `@movo/shared` — su modelo local ya coincidía estructuralmente, no era
necesario para este ticket mobile-only.

### MOVO-127 — Pantalla de detalle de un envío específico (`movo-mobile`)

Reemplaza el placeholder mínimo de `app/(app)/shipments/[id].tsx` (MOVO-83) por el
detalle real: ruta, paquete (con fotos), ventana de retiro/precio, receptor y —si
tiene— transportista, línea de tiempo y banner de ofertas. Referencia visual: pantalla
"02 · Detalle del pedido" del proyecto Claude Design "Movo Mobile Main Views".

Primera versión (antes de probarla en dispositivo) recortaba tabs, banner de ofertas y
link de cancelar del mock. Tras probarla, feedback del usuario revirtió dos de esos
recortes:
- **Tabs Detalles/Línea de tiempo del mock, mantenidas** (`useState<DetailTab>`) en vez
  de un solo scroll con todas las secciones apiladas — la tab de línea de tiempo queda
  planteada aunque MOVO-128 (backend de eventos) siga sin arrancar, mostrando
  `TimelineSection` (estado vacío) en su propio tab en vez de mezclada con el resto.
- **`OffersBanner` nuevo** (`components/shipments/offers-banner.tsx`): siempre en
  estado vacío ("Aún no tenés ofertas", sin `onPress`) hasta que exista MOVO-17 —
  mismo lenguaje visual "bloqueado" que `HomeSendCta` (icono en círculo mute, sin
  acento de color). Solo se muestra si el envío sigue abierto a ofertas (`!carrierId`
  y el receptor ya confirmó, `receiverConfirmationStatus === "confirmed"`).
- **CTA "Volver a Inicio" al pie de la pantalla, eliminado** — no aportaba nada que el
  botón de volver del header no hiciera ya.
- **Badge de confirmación del receptor** en `CounterpartCard` (prop
  `receiverConfirmation`, solo para el receptor, nunca para el transportista):
  "Pend. de aceptar" / "Aceptó el envío" / "Rechazó el envío", derivado de
  `shipment.status` vía `receiverConfirmationStatus()` nueva en `shipment-format.ts`
  (no hay columna separada — `awaiting_receiver_confirmation`/`rejected_by_receiver`
  son los únicos dos estados donde todavía no confirmó, cualquier estado posterior
  implica que sí).

- **`RouteMapCard` generalizado para reuso fuera del wizard** (`components/send/
  route-map-card.tsx`): `onEdit` pasa a opcional (sin botón de lápiz si no se pasa) y
  el tipo de `pickup`/`delivery` se angosta de `AddressSelection` (con un `source` que
  el componente nunca usaba) a `{ address, lat, lng }` — desacopla el mapa del estado
  del wizard, `AddressSelection` lo sigue satisfaciendo por tipado estructural. El
  detalle de envío reusa el mismo mapa animado del paso de resumen del wizard
  (MOVO-83/123), no la card estática del mock de diseño.
- **`components/shipments/`** nuevo: `ShipmentStatusBadge` (extraído, antes duplicado
  en el placeholder y en `RecentShipmentsSection`), `PackageCard` (consume
  `GET /shipments/:id/photos`, MOVO-81, nuevo `listPhotos`/`useShipmentPhotos`),
  `CounterpartCard` (reusa `AvatarImage`/`ProfileVerifiedBadge` ya existentes de
  perfil, consume `GET /users/:id` vía nuevo `usersClient.getPublicProfile`/
  `usePublicProfile`), `TimelineSection`.
- **Timeline contra datos reales (`TimelineSection`, MOVO-128 ya mergeado a
  `develop`)**: consume `GET /shipments/:id/events` vía `listEvents`/
  `useShipmentEvents` nuevos, en el orden ascendente que devuelve el backend — el
  último evento es el estado actual y se destaca en `text-fg` (el resto en `fg-2`).
  Riel vertical dibujado dentro de cada fila (`w-px flex-1`), no como una línea
  absoluta detrás de todas: se estira solo hasta el alto real del evento, que varía
  según tenga `reason` o no.
  - **Título anclado al círculo por construcción** (caja `h-9 justify-center`, mismo
    alto que el círculo), no con un padding calculado contra el line-height: ese
    cálculo alineaba bien las filas de una sola línea pero se rompía apenas la fila
    tenía fecha/actor debajo (feedback post-QA en device).
  - **Ritmo fijo (`min-h-[56px]` + `pb-5`), no reparto del alto de pantalla**: una
    iteración intermedia estiraba las filas con `flex-1` para llenar la vista, y con
    los 5-6 pasos típicos de un envío dejaba huecos enormes entre eventos. Sigue valiendo el criterio original: si el historial
  viene vacío se muestra un estado vacío explícito, nunca se sintetizan eventos a
  partir de `status`/`lastStatusChangedAt` (perdería los pasos intermedios).
  - `shipmentEventTitle()` (narrativa en pasado, "El paquete salió en camino")
    separada de `shipmentStatusLabel()` (nombra el estado actual) — el evento con
    `fromStatus === null` se lee como "Envío creado", no como "Esperando confirmación".
  - **La aceptación del receptor no tiene estado propio**: es exactamente la
    transición `awaiting_receiver_confirmation → published` (un solo `updateStatus` en
    `acceptShipment`, MOVO-129), así que el backend registra un único evento. Titularlo
    por su `toStatus` lo mostraba como "Publicado para transportistas" y escondía el
    paso que el emisor está esperando — se titula por la acción de la persona ("El
    receptor aceptó el envío") con la publicación como consecuencia debajo
    (`shipmentEventDetail()`, hoy el único caso). Por lo mismo, el paso pendiente de
    `published` se llama "Aceptación del receptor", no "Publicación".
  - `shipmentActorLabel()` resuelve `actorId` contra `senderId`/`receiverId`/
    `carrierId` que el detalle ya tiene cargados, en vez de pedir `GET /users/:id` por
    evento: el rol ("Vos"/"El receptor"/"El transportista") es lo informativo en una
    línea de tiempo, y el nombre de la contraparte ya lo muestra `CounterpartCard`.
    `actorId: null` (transición sin persona detrás) no muestra actor; un id ajeno a
    las tres partes (admin resolviendo una disputa) cae a "Equipo Movo".
  - **Pasos futuros proyectados en gris apagado** debajo del último evento
    (`remainingLifecycleSteps()` + `shipmentPendingStepLabel()`): recorren el camino
    feliz de `shipment-state-machine.ts` (`svc-shipments`, MOVO-105) desde el estado
    actual hasta `delivered`, con círculo vacío de borde punteado (el relleno de color
    se gana al ocurrir de verdad), texto `fg-3`, y sin fecha ni actor. Un envío fuera
    del camino feliz (`cancelled`/`rejected_by_receiver`/`disputed`) no proyecta nada
    — prometer "Entrega al receptor" debajo de un envío cancelado sería mentir.
    Etiquetas en sustantivo ("Retiro del paquete"), nunca el pasado de
    `shipmentEventTitle` — un paso futuro descrito en pasado se lee como ya ocurrido.
    La proyección sale del `toStatus` del último evento, no de `shipment.status`: toda
    la línea se lee contra una sola fuente, sin poder desincronizarse entre queries.
  - `formatEventTimestamp()` sí usa `new Date` y la zona horaria del dispositivo (a
    diferencia de `formatPickupDateLabel`, ver MOVO-80): `createdAt` viaja como ISO
    datetime completo con offset, y "cuándo pasó esto" se lee en hora local.
- **Errores 403/404 de `useShipment` distinguidos** vía `ApiError.statusCode`
  (`@movo/shared/dist/errors/api-error`) — "no te pertenece" vs. "no existe" en vez
  del banner genérico único que tenía el placeholder.
- Wiring de navegación: `ShipmentRow` de `RecentShipmentsSection` (antes sin
  `onPress`) navega a `/shipments/${id}`.
- **Botón de volver del header corregido**: usaba `router.replace(home)`, que
  reemplaza la entrada actual de la pila en vez de sacarla — Expo Router lo animaba
  como una pantalla nueva entrando, no como la actual saliendo hacia atrás (reportado
  por el usuario probando en dispositivo). Ahora `router.back()` si
  `router.canGoBack()`, con `replace(home)` solo como fallback para una futura entrada
  directa sin historial (push notification, MOVO-107 AC6 todavía sin destino real).
- **Visor de fotos de evidencia a pantalla completa** (`components/shipments/
  photo-viewer-modal.tsx`, feedback post-QA: antes las fotos de `PackageCard` eran
  solo un conteo en texto, sin forma de verlas). `PackageCard` ahora muestra una tira
  de miniaturas reales (`Image`, 56×56); tocar una abre `PhotoViewerModal` en esa
  foto — `FlatList` horizontal paginado (`initialScrollIndex` + `getItemLayout`, sin
  el salto/flash de animar el scroll después del primer render), contador "N / M" y
  cierre. Mismo patrón de `Modal` nativo que `AddressSearchSheet`/`select-field` (el
  repo no usa presentación modal de expo-router en ningún lado todavía) — no una ruta
  nueva, a propósito.
  - **Centrado vertical corregido**: la primera versión restaba un alto de header fijo
    a mano (`Dimensions().height - 80`) para el contenedor de la imagen — no coincidía
    con el alto real del header (safe area + fila), dejando la foto visualmente
    descentrada (reportado por el usuario probando en dispositivo). Ahora el
    contenedor de cada foto usa `flex: 1` dentro del layout de `SafeAreaView`, sin
    ningún cálculo manual — el sistema de layout resuelve el alto disponible real.
  - **Pinch-to-zoom + pan + doble tap** (`ZoomableImage`, componente local del mismo
    archivo): primer uso real de la API de gestos de `react-native-gesture-handler`
    en el repo (ya era dependencia transitiva, pero ningún componente la usaba) —
    requirió agregar `GestureHandlerRootView` en la raíz (`app/_layout.tsx`, tiene que
    envolver todo el árbol de navegación para que los gestos nativos se registren,
    sobre todo en Android) y `react-native-gesture-handler/jestSetup.js` a
    `setupFiles` de `jest.config.js`. El `FlatList` del visor es el de
    `react-native-gesture-handler` (no el de React Native) para que su scroll
    conviva con los gestos de pinch/pan sin pelearse por el mismo puntero;
    `scrollEnabled` del `FlatList` se desactiva mientras una foto está agrandada
    (`onZoomChange`), si no arrastrar dentro de una foto zoomeada competiría con el
    paginado horizontal entre fotos. Doble tap alterna entre escala 1 y 2.5x.
    - **Bug encontrado en device tras el primer merge**: el swipe entre fotos no
      andaba nunca, con o sin zoom. Causa: `Gesture.Pan()` (un dedo) quedaba
      *siempre* activo — el `if (savedScale.value <= 1) return` de adentro solo
      evitaba mover la imagen, pero el gesto igual "reclamaba" el touch antes que el
      scroll nativo del `FlatList` pudiera recibirlo. Fix: `pan.enabled(isZoomed)`,
      con `isZoomed` como estado de React espejado desde los shared values (gatea el
      gesto en sí, no solo su efecto) — sin zoom, `Gesture.Pan()` queda excluido de
      `Gesture.Simultaneous(pinch, pan)` y el touch de un dedo cae directo al scroll
      del `FlatList`.
- **Skeletons animados en vez de `ActivityIndicator`** (feedback post-QA): el header
  del skeleton replica el layout real (volver + título + badge), evita el doble
  header renderizando `ShipmentDetailSkeleton` completo en vez del `ActivityIndicator`
  centrado de antes. El pulso (opacidad 0.5↔1 en loop, Reanimated) se agregó al
  `SkeletonBlock` **compartido** (`components/ui/skeleton-block.tsx`), no como algo
  aislado de esta pantalla — se propaga gratis a `ProfileSkeleton` y a cualquier
  consumidor futuro, decisión tomada con el usuario para no terminar con dos sistemas
  de skeleton distintos conviviendo en la app. `components/shipments/
  shipment-detail-skeleton.tsx` nuevo (mismo alto que `RouteMapCard` en el
  placeholder del mapa, sin salto de layout al terminar de cargar);
  `PackageCard`/`CounterpartCard` también cambiaron sus spinners chicos por bloques
  con la forma real del contenido (miniaturas/avatar+nombre).

Pendiente / fuera de alcance: cancelar envío (MOVO-29, resuelto después, ver su propia
entrada más abajo), detalle/lista de ofertas (MOVO-17), handshake/tracking en vivo
(MOVO-6/MOVO-11) — igual que documenta el propio ticket.

### Pantalla "Mis Envíos" (listado completo, punto de acceso desde Inicio)

`useRecentShipments` (preview de 3 en Inicio) documentaba desde MOVO-83 que el listado
completo quedaba "fuera de este ticket" — se implementó como parte del pulido de
MOVO-127: `app/(app)/shipments/index.tsx` nueva, listado paginado con scroll infinito
(`useMyShipments`, `useInfiniteQuery` de TanStack Query — primer uso en el repo, query
key `["shipments","mine","list"]` separada de la del preview) y pull-to-refresh (primer
uso de `RefreshControl` en el repo).

- **`ShipmentCard` nueva** (`components/shipments/shipment-card.tsx`), no la fila de una
  sola línea (`ShipmentRow`) reusada del preview de Home — feedback post-QA: esa fila
  "quedaba horrible" repetida en un listado largo. Reinterpretación de una card de
  referencia (viaje/transportista con foto+nombre, badge de estado, mini-ruta con dos
  puntos y hora) sin la foto/nombre — acá no hay contraparte asignada todavía, el
  precio ocupa ese lugar. `shortAddressLabel`/`formatPickupWindowLabel` nuevas en
  `shipment-format.ts` para el segmento corto de dirección (antes de la primera coma,
  no hay campo de barrio separado) y el rango horario. `ShipmentRow` (fila compacta de
  una línea) se mantiene sin cambios, sigue siendo la correcta para el preview de 3 de
  Home — cada pantalla su propia densidad de información.
- **Punto de acceso, a propósito deliberadamente discreto y en su propia sección**: dos
  iteraciones previas de este cambio lo pusieron como botón/card secundario en Inicio
  (mismo peso visual que `HomeSendCta`) y después como link al pie de la card de
  Actividad Reciente — el usuario rechazó ambas explícitamente. Quedó como
  `ViewAllShipmentsLink` (`components/home/view-all-shipments-link.tsx`), sección propia
  debajo de `RecentShipmentsSection` en `home.tsx`: botón outline chico y centrado
  (borde `border-border`, texto `text-fg-2`), reusa `useRecentShipments()` (mismo query
  key, TanStack Query dedupe la request) para decidir si mostrarse — solo con al menos
  un envío.
- `useCreateShipment` ahora invalida también `["shipments","mine","list"]` (antes solo
  invalidaba el preview) para que un envío nuevo aparezca en el listado completo sin
  esperar un refetch manual.

Tests nuevos: `test/shipment-row.test.tsx`, `test/shipment-card.test.tsx`,
`test/view-all-shipments-link.test.tsx`, `test/shipments-list-screen.test.tsx`.

**Iteración siguiente (mismo día, feedback post-QA con referencia visual de Uber
"Activity"):** título grande ("Mis envíos", `text-title`, reemplaza el `text-h3` chico
junto al botón volver) + tabs "En curso"/"Completados" + botón de filtro circular
(`SlidersHorizontal`) que abre una hoja inferior con chips de estado — mismo patrón de
`Modal` que ya usa `SelectField` (overlay + hoja `rounded-t-2xl` + `SafeAreaView
edges={['bottom']}`), nunca un componente de sheet nuevo.

- **`shipmentLifecycleStage` nueva** en `shipment-format.ts`: agrupa el `ShipmentStatus`
  en `"ongoing" | "past"` — `DELIVERED`/`CANCELLED`/`REJECTED_BY_RECEIVER` son los
  únicos "pasados", `DISPUTED` cuenta como en curso (todavía espera resolución, no es un
  estado final desde la perspectiva del usuario).
- **Tab + filtro de estado, 100% client-side** sobre las páginas ya cargadas de
  `useMyShipments` — `GET /shipments/mine` no tiene un parámetro de estado en el backend
  todavía (MOVO-80). El scroll infinito sigue pidiendo la próxima página según
  `hasNextPage` de la query completa, sin depender de cuántos items sobrevivan al
  filtro visible en pantalla — aceptable para el volumen de envíos de un usuario real,
  pero si el filtrado server-side se vuelve necesario (usuarios con cientos de envíos)
  es un ticket de backend aparte.
- Las opciones de chip de la hoja de filtro dependen de la tab activa (en "En curso" no
  tiene sentido ofrecer "Entregado" como filtro) — cambiar de tab resetea el filtro a
  "Todos".
- **Tres iteraciones de diseño del punto de acceso desde Home documentadas en la
  entrada de arriba** — quedó como link de ancho completo en su propia sección, nunca
  como botón/card que compita con `HomeSendCta`.

**Segunda iteración de los filtros (mismo día, feedback post-QA sobre la primera):**
los chips de "Estado" (6 opciones abiertas de una) "no funcionaban, son demasiados" y
el botón "Aplicar" quedaba pegado contra el último renglón en pantallas chicas. Se
reemplazó por `FilterDropdown` — mismo patrón que `SelectField` (trigger cerrado +
`Modal` inferior con lista y check), generalizado a `{ id, label }` en vez de solo
`string` — necesario para el filtro nuevo de "Destinatario", donde el label (nombre)
solo no alcanza para identificar sin ambigüedad a la persona si dos comparten nombre.
Cada dropdown aplica al elegir una opción (sin botón "Aplicar" separado); un link
"Limpiar" en el header de la hoja resetea ambos filtros a la vez.

- **`usePublicProfiles` nueva** en `use-profile.ts` (`useQueries` de TanStack Query,
  mismo query key por id que `usePublicProfile` — comparte cache, no duplica requests
  si `CounterpartCard` ya trajo alguno de esos perfiles) — resuelve los nombres reales
  de los destinatarios únicos de la tab activa antes de listarlos como opciones del
  filtro.
- Cambiar de tab ("En curso"/"Completados") resetea ambos filtros — el set de
  destinatarios/estados disponibles es distinto por tab, un filtro que sobrevive al
  cambio podría apuntar a una opción que ya no existe en la tab nueva.

### MOVO-131 — Vista de receptor en el detalle del envío: perfil del emisor y acciones de aceptar/rechazar (`movo-mobile`)

Perspectiva del receptor sobre la pantalla de detalle de envío (`app/(app)/shipments/[id].tsx`, MOVO-127), resolviendo el frontend de MOVO-16 (AC3, AC4, AC7) sin bifurcar la pantalla en vistas separadas por rol.

- **Detección dinámica de rol en `shipments/[id].tsx`**: compara `useAuthStore().user?.userId` con `shipment.receiverId` / `shipment.senderId`. Mirando como receptor, la sección de contraparte titula "Emisor" y muestra el perfil público de `shipment.senderId` (foto, nombre, insignia de verificado, reputación) mediante `CounterpartCard` + `usePublicProfile`, omitiendo el badge de confirmación (solo aplica cuando la contraparte es el receptor).
- **`ReceiverActionsBar` nueva (`components/shipments/receiver-actions-bar.tsx`)**: barra de acciones fija al pie, mostrada únicamente cuando el usuario es el receptor y el envío está en `AWAITING_RECEIVER_CONFIRMATION`.
  - **Aceptar envío**: CTA primaria con acento Signal Lime (`bg-lime-500`, texto oscuro), pide confirmación mediante un modal propio in-app (mismo diseño que el de rechazo) y ejecuta `POST /shipments/:id/accept`.
  - **Rechazar**: botón secundario/destructivo que abre modal in-app de confirmación con advertencia de irreversibilidad y campo opcional para motivo (`reason`, máx 500 caracteres, `POST /shipments/:id/reject`).
  - **Deadline de confirmación**: calcula y muestra el tiempo restante en horas ("Te quedan 36 h para confirmar", "Te queda 1 h para confirmar") con formateo puro (`formatReceiverConfirmationDeadline` en `src/lib/shipment-format.ts`), degradando silenciosamente si no viene o ya expiró.
  - **Bloqueo de doble tap y feedback de errores**: deshabilita ambos botones con spinners durante mutación en vuelo. Mapea `ApiError.statusCode` a mensajes específicos (409 → "Este envío ya no se puede confirmar" + refetch del detalle; 403 → "No sos el destinatario de este envío"; banner genérico para el resto).
- **Mutaciones en `use-shipments.ts`**: `useAcceptShipment` y `useRejectShipment` (`POST /shipments/:id/accept` y `/reject` en `shipments-client.ts`) invalidan queries `["shipments", "mine"]`, `["shipments", "mine", "recent"]`, `["shipments", "mine", "list"]` y `["shipments", "detail", id]` actualizando la cache para reflejar el estado sin salir de la pantalla.

### MOVO-135 — Pantalla "Editar perfil" con cambio verificado de teléfono y email

Frontend de MOVO-31 sobre los endpoints de MOVO-133. Ruta nueva `app/(app)/profile/edit.tsx`
más dos sub-flujos hermanos (`change-phone.tsx`, `change-email.tsx`), con entrada desde un
botón de lápiz en el header de la tab de perfil (no desde Configuración — ahí vive "Cuenta y
seguridad", MOVO-136).

Decisiones clave:
- **Nada de botón Guardar: todo se persiste solo.** La foto al elegirla (`PhotoPicker` de
  MOVO-98, reusado tal cual), y nombre/apellido **al salir del campo** (`onBlur`, no por
  tecla — sería un PATCH por carácter). Solo sale la request si el valor cambió de verdad
  contra el perfil cargado, así entrar y salir de un campo sin tocarlo no genera tráfico ni
  arriesga el 409 `PROFILE_NAME_LOCKED_BY_KYC`. Si el guardado falla, el campo se revierte
  al valor persistido: dejar en pantalla un texto que el backend rechazó haría creer que
  quedó guardado.
- **Teléfono y email no son inputs**: son filas navegables con chevron hacia su sub-flujo
  de OTP. Un input que parece editable y después no guarda sería mentirle al usuario —
  cambiarlos exige probar posesión.
- **El paso de OTP se extrajo del wizard de registro en vez de duplicarse**:
  `components/ui/otp-input.tsx` (6 casillas, paste de iOS, backspace, foco),
  `src/hooks/use-otp-cooldown.ts` y `components/ui/otp-step.tsx` (la sección visual
  completa). `app/(auth)/register.tsx` los consume — perdió ~100 líneas netas y quedó una
  sola implementación en el repo. Los `testID` `register-otp-*` se preservaron vía
  `testIDPrefix`, así `use-registration.test.tsx` siguió pasando sin tocarse (fue la red de
  seguridad de la migración). De paso se corrigió el contador, que estaba hardcodeado como
  `00:${padStart(2)}` y mostraba "00:120" con cualquier cooldown de más de 99 segundos;
  `formatCooldown` ahora saca los minutos del valor real.
- **`SuccessBanner` nuevo** (`components/ui/success-banner.tsx`), espejo de `ErrorBanner`:
  el AC2 pide "confirmación visual" y el repo no tenía ningún patrón para el éxito (las
  mutaciones se confirmaban solas cerrando la pantalla, y `Alert.alert` nunca se usó para
  eso). A diferencia de `ErrorBanner` —persistente a propósito— este se auto-oculta a los
  3s: una confirmación fija se lee como estado permanente de la pantalla. Sin librería de
  toast, que era una dependencia nueva injustificable por un banner.
- **`setQueryData` en vez de `invalidateQueries`** en las mutaciones de `use-profile.ts`:
  los tres endpoints de escritura devuelven el `PrivateProfile` completo, así que refetchear
  sería una request de más y dejaría la tab de perfil con el dato viejo durante ese viaje.
  Sincronizan además `fullName` en el store de sesión (`auth-store.ts#updateFullName`, nuevo,
  hermano de `updateKycStatus`) — vive persistido en secure-store y `home.tsx` lo usa como
  fallback del saludo, así que sin eso el nombre viejo sobrevivía hasta el próximo login.
- **El OTP de cambio de email va al teléfono actual, no al email nuevo** (no hay
  `EmailProvider` en el proyecto, ver MOVO-133). La pantalla lo dice dos veces —en un aviso
  antes de pedirlo y en el copy del paso del código— porque recibir un SMS al cambiar el
  email, sin explicación, es desconcertante.
- **`422 AUTH_OTP_EXPIRED` se trata distinto de `401 AUTH_OTP_INVALID`**: el código
  incorrecto se reintenta en el mismo paso (se limpia el input y se vuelve a enfocar); el
  vencido devuelve al paso 1, porque tipear de nuevo no lo arregla, hace falta pedir uno
  nuevo. El ticket solo mencionaba el 401.
- **`TextField` ganó `disabled`**: hasta ahora `editable={false}` no cambiaba nada
  visualmente. Necesario para el bloqueo por KYC (AC3) — el usuario tiene que ver que no se
  puede editar antes de intentarlo, no chocarse con un 409 `PROFILE_NAME_LOCKED_BY_KYC`.

Ajustes pedidos durante la implementación (feedback del usuario, ya aplicados):
- **La tab de perfil dejó de tener el lápiz de editar foto y la sección "Tus datos
  personales"**: ambas cosas viven ahora solo en "Editar perfil". `profile.tsx` usa
  `ProfileAvatar` (solo lectura) en vez de `PhotoPicker`, y ya no monta
  `ProfilePrivateSection` — tenerlo en las dos pantallas duplicaba la misma información y
  dos puntos de entrada para la misma acción.
- **DNI visible y de solo lectura** en el formulario, junto al nombre. Requirió agregarlo a
  `PrivateProfile` (ver `shared/movo-shared/CLAUDE.md` y el de `svc-users`): estaba excluido
  a propósito desde MOVO-77 "hasta confirmar con quien implemente MOVO-31 si hace falta", y
  esta US es esa confirmación. Nunca editable, con candado y copy explicando por qué.
- **Se eliminó el botón Guardar** a pedido del usuario, con razón: gobernaba solo dos campos
  (la foto ya se guardaba sola y teléfono/email tienen su propio flujo) y con KYC aprobado
  quedaba deshabilitado de forma permanente. Pasó a guardado al blur, descripto arriba.
  **Esto deja sin efecto el AC8 del ticket** ("salir con cambios sin guardar pide
  confirmación"): sin botón no existe un estado "sin guardar", así que se sacaron el
  `Alert.alert` de descarte y el listener de `beforeRemove` que lo cubría. AC a actualizar
  en Linear.
- **Insignia de verificado en lugar del texto "Verificar para cambiar"**: chip lime
  `Verificado`, originalmente **solo en la fila del teléfono** — en el momento de esta
  US no existía ningún concepto de verificación de email en el sistema (sin columna
  `email_verified` ni `EmailProvider`; por eso el OTP del cambio de email iba al
  teléfono), así que un chip verde ahí habría sido falso. Cerrado por MOVO-139, ver
  abajo. Obligó a exponer `phoneVerified` en `PrivateProfile`, mismo movimiento que el
  DNI.

Tests: `edit-profile-screen.test.tsx`, `change-phone-screen.test.tsx`,
`change-email-screen.test.tsx`, `otp-input.test.tsx`, `use-otp-cooldown.test.ts`,
`success-banner.test.tsx`, más casos en `users-client.test.ts` y `profile.test.tsx`.
57 suites / 396 tests en `movo-mobile`, `tsc --noEmit` limpio.

Gotcha del entorno de tests (no de la implementación): `render`/`renderHook` de RNTL son
**asíncronos** en este setup (React 19 concurrente) — sin `await` devuelven una promesa y
`getByTestId` "no es una función". Y un `fireEvent.press` sin envolver en
`await act(async () => ...)` deja trabajo de React pendiente que rompe el render del test
**siguiente**, no el propio: un test que pasa aislado y falla en la suite completa es casi
siempre eso.

**Cierre del email (MOVO-139, backend ya en `develop`): insignia y CTA de verificar
email.** Con `EmailProvider`/`emailVerified` ya reales (ver `services/
movo-svc-users/CLAUDE.md` y `shared/movo-shared/CLAUDE.md`), la fila de email en
`edit.tsx` deja de estar coja: muestra el mismo chip lime `Verificado` que el teléfono
cuando `profile.emailVerified` es `true`, y un chip outline `Verificar` cuando no —
para las cuentas creadas antes de este ticket, que quedaron todas en `false` por
backfill natural.

- **`onVerifyPress` en `ContactRow`, no otro componente**: el chip `Verificar` vive
  adentro de la misma fila que ya navega a `change-email` al tocarla — nested
  `Pressable`s (RN resuelve el touch al componente más específico, sin bubbling tipo
  DOM) evita que tocar el chip también dispare la navegación a cambiar email.
- **`app/(app)/profile/verify-email.tsx` nueva, hermana de `change-email.tsx` pero
  sin paso de input**: el target del OTP es el email que la cuenta ya tiene (AC1/AC2
  de MOVO-139 del lado backend), así que el paso 1 es directo "Enviar código" en vez
  de pedir una dirección — dos etapas (`"intro" | "otp"`) en vez de tres. Reusa
  `OtpStep`/`useOtpCooldown`/`otpRef` con el mismo criterio que `change-phone.tsx`/
  `change-email.tsx` (422 vencido vuelve al paso 1, 401 se reintenta en el mismo paso).
- **`change-email.tsx` corregido para MOVO-139**: el OTP del cambio de email ahora
  va al email **nuevo** (ya no al teléfono actual) — se sacó el aviso `change-email-
  sms-notice` y el copy de ambos pasos pasó a nombrar la dirección nueva, no el
  teléfono.
- **`useRequestEmailVerification`/`useVerifyEmailVerification` nuevos** en
  `use-profile.ts`, mismo criterio que sus pares de teléfono/cambio de email (`setQueryData`
  con el `PrivateProfile` completo que devuelve el backend, no `invalidateQueries`).

Tests nuevos: `verify-email-screen.test.tsx`; casos agregados a
`edit-profile-screen.test.tsx` (insignia/CTA de email en ambos estados, tocar el CTA
navega a `verify-email` sin disparar `change-email`), `change-email-screen.test.tsx`
(copy actualizado al email nuevo) y `users-client.test.ts`.

### MOVO-132 — Envíos que recibo: distinción de rol en el listado y entrada desde la notificación push (`movo-mobile`)

Completa el camino por el que el receptor llega a la pantalla de confirmación (AC1, AC2 y AC4 de MOVO-16), resolviendo la distinción de rol en tarjetas y la navegación desde notificaciones push.

- **Distinción de rol en tarjetas y filas (`ShipmentCard` y `ShipmentRow`)**:
  - Resuelve `isReceiver` comparando síncronamente `useAuthStore().user?.userId === shipment.receiverId`.
  - Muestra un tag visual de rol: *"Recibís"* (`bg-info-100 text-info-700`) y *"Enviás"* (`bg-bg-mute text-fg-2`).
  - **Badge contextual según rol (`ShipmentStatusBadge`)**: en `AWAITING_RECEIVER_CONFIRMATION`, muestra *"Requiere tu confirmación"* para el receptor (con deadline restante `formatReceiverConfirmationDeadline` si aplica) y *"Esperando al receptor"* para el emisor.
- **Filtro de Rol en "Mis Envíos" (`app/(app)/shipments/index.tsx`)**:
  - Suma la sección **"Rol"** a `ShipmentsFilterSheet` con pills: `Todos` / `Enviados` / `Recibidos` (100% client-side).
  - **Prioridad en la cima**: en la pestaña "En curso", los envíos recibidos en `AWAITING_RECEIVER_CONFIRMATION` se ordenan primero para destacar la acción pendiente requerida.
- **Navegación desde Push Notifications (`use-push-notifications.ts`)**:
  - Tocar una notificación con `data.type === "shipment"` navega directo a `/shipments/:id` (cierra el pendiente que MOVO-107 dejó documentado).
  - Soporta **cold start**: `Notifications.getLastNotificationResponseAsync()` resuelve la notificación inicial una vez restaurada la sesión autenticada.
  
### MOVO-136 — Pantalla "Cuenta y seguridad": cambio de contraseña y baja de cuenta

Convierte el primer ítem de Perfil → Configuración (`profile-settings-section.tsx`,
MOVO-78) en ruta real, igual que hizo MOVO-121 con "Direcciones guardadas". Consume el
backend de MOVO-134, ya mergeado a `develop`; absorbe además la parte mobile de
MOVO-39 (derecho de supresión).

Se implementó en dos pasadas: primero el hub + cambio de contraseña, y la baja de
cuenta después, cuando MOVO-133/MOVO-134 entraron a `develop` — sus códigos de error
(`ACCOUNT_HAS_ACTIVE_SHIPMENTS`, `ACCOUNT_HAS_ACTIVE_DISPUTES`,
`ACCOUNT_DELETION_IN_PROGRESS`, `SHIPMENTS_SERVICE_UNAVAILABLE`) viven en
`@movo/shared`, y el mobile importa `@movo/shared/dist/`, o sea el build: hasta ese
merge `error-messages.ts` no podía tiparlos.

- **`app/(app)/profile/security.tsx` es un hub, no un formulario único**: cada acción
  vive en su propia ruta. No es estética — la baja de cuenta (irreversible) no puede
  compartir contenedor de scroll con el formulario de contraseña. No expone "última
  vez que cambiaste la contraseña" ni "sesiones activas": el backend no publica
  `passwordUpdatedAt` ni un listado de sesiones.
- **La persistencia de la sesión nueva es parte de la operación, no un `onSuccess`**
  (`changePasswordAndPersistSession()` en `src/hooks/use-account-security.ts`).
  `POST /users/me/password` revoca todas las sesiones y devuelve un par de tokens
  nuevo; si no se persiste, el access token en memoria sigue andando (JWT stateless,
  ADR-004) y la app recién muere cuando expira — hasta 60 min después, con el refresh
  ya revocado. Fallo diferido e invisible en QA manual, así que no puede depender de
  que un caller encadene un callback. De paso fija el orden: el `onSuccess` de la
  pantalla corre siempre después de que los tokens quedaron en secure-store.
- **`friendlyErrorMessage()` acepta `overrides` por pantalla**:
  `AUTH_INVALID_CREDENTIALS` está redactado para el login ("El teléfono o la
  contraseña no son correctos"), pero acá no hay ningún teléfono en juego — significa
  "la contraseña actual no es correcta". Es un override local, no un cambio del mapa
  global.
- **`isPasswordValid` extraído** de `use-registration.tsx` (módulo del `Context` del
  wizard entero) a `src/lib/password-policy.ts`, re-exportado desde el original —
  mismo criterio que MOVO-121 con `AddressSelection`.
- Detalles de UI: un toggle de ojo **por campo** (no el `showPassword` compartido del
  registro — revelar la nueva no debería exponer la actual); validación en `onBlur`,
  nunca por tecla, salvo el medidor de fuerza que es feedback positivo; el aviso de
  cierre de sesión en otros dispositivos va **antes** de enviar, no después; el éxito
  es un estado de pantalla (mismo criterio que `kyc.tsx`) y no un `Alert`, porque el
  repo evitó a propósito traer una librería de toast; el 401 se ancla bajo el campo de
  contraseña actual (con foco), el resto va al `ErrorBanner`.
- **Baja de cuenta con tres barreras, no un `Alert` solo** (`app/(app)/profile/
  delete-account.tsx`, AC5): entrar a la ruta desde el hub → marcar el reconocimiento
  explícito y escribir la contraseña → confirmar en el `Alert` nativo con el botón
  destructivo. El diálogo es el último paso y no el único: es el patrón que la
  plataforma ya enseñó a leer como "sin vuelta atrás", pero no es lugar para explicar
  cuatro consecuencias, y enterarte de lo que perdés después de haber escrito la
  contraseña no es consentimiento informado. En el hub va bajo "Zona de riesgo", en
  tarjeta aparte con borde `danger` — nunca compartiendo tarjeta con "Contraseña".
- **`deleteAccountAndClearSession()` limpia con `clearSession()`, nunca `logout()`**:
  `logout()` pega contra `POST /auth/logout` y `DELETE /notifications/push-tokens` con
  el token de una cuenta que el backend ya anonimizó y cuyas sesiones ya revocó — dos
  requests condenados a fallar contra recursos que ya no existen, y la baja ya hace
  del lado del servidor todo lo que `logout()` haría. Antes de eso, `queryClient.clear()`:
  sin eso el perfil/envíos/direcciones de la cuenta borrada sobreviven en memoria y se
  pintan por un frame en el próximo login de OTRO usuario del mismo dispositivo (AC6
  pide "sin sesión guardada ni caché de perfil"). No hay pantalla de éxito — el guard
  de `app/(app)/_layout.tsx` redirige solo a `/login` al caer `status`.
- **Los dos 409 de la baja no son "error, reintentá"**: el backend no cancela en
  cascada a propósito, son estados que el usuario tiene que resolver. El de envíos
  activos ofrece "Ver mis envíos" accionable; el de disputas no, porque ahí no hay
  nada que el usuario pueda hacer más que esperar a un administrador — un atajo que no
  lleva a ningún lado es peor que ninguno.
- **AC6 del ticket corregido en Linear**: pedía que el login post-baja fallara "con el
  mensaje de cuenta dada de baja". No es satisfacible — `anonymizeAndDelete()` de
  MOVO-134 reescribe el teléfono, así que el login devuelve `401
  AUTH_INVALID_CREDENTIALS` y no `403 ACCOUNT_SUSPENDED` (el propio PR del backend lo
  documenta en su test "AC9 (regresión)"). Es el derecho de supresión de MOVO-39
  funcionando; además un mensaje explícito sería un oráculo de enumeración.

**Nota de testing (para el próximo que escriba un test de hook acá):** montar
`useMutation` de TanStack Query bajo `jest-expo` deja el proceso de Jest sin terminar
("A worker process has failed to exit gracefully"), incluso con `queryClient.clear()`
+ `unmount()` y sin handles abiertos según `--detectOpenHandles`. `renderHook` solo y
`QueryClientProvider` solo andan bien; es `useMutation` el que cuelga. Por eso la
lógica testeable se extrajo a una función async pura y el test no monta React.

Tests nuevos: `test/password-policy.test.ts`, `test/use-account-security.test.ts`
(AC2/AC6), `test/change-password-screen.test.tsx` (AC3/AC4/AC7),
`test/delete-account-screen.test.tsx` (AC5/AC7), `test/security-screen.test.tsx`
(AC1), más casos agregados a `test/profile-settings-section.test.tsx` y
`test/users-client.test.ts`. El interceptor que garantiza AC3 a nivel de red ya estaba
cubierto desde MOVO-76 (`http-client.test.tsx`: "no dispara refresh ante
AUTH_INVALID_CREDENTIALS"). El callback del `Alert` nativo se ejecuta dentro de
`act()` en el test de la baja: no pasa por ningún evento de RNTL, así que sin eso los
`setState` del `onError` no se flushean antes del assert. 55/55 suites, 390/390 tests.
`tsc --noEmit` limpio.

Pendiente / fuera de alcance: AC6 solo se verifica hasta donde llega el mobile (la
sesión y la caché quedan limpias y la app cae al login) — que el login posterior con
las credenciales viejas falle es comportamiento del backend, cubierto por el test
"AC9 (regresión)" de MOVO-134, no se duplica acá.

### MOVO-29 — Cancelar envío, lado emisor (`movo-mobile`)

Resuelve la parte de MOVO-29 que había quedado explícitamente afuera de MOVO-127
("Sin link de cancelar (MOVO-29 aparte)"). El backend (`POST /shipments/:id/cancel`)
ya existía, mergeado a `develop` como parte de MOVO-108 (ver
`services/movo-svc-shipments/CLAUDE.md`) — este ticket es 100% mobile.

- **`SenderActionsBar` nueva (`components/shipments/sender-actions-bar.tsx`)**: un
  ícono de tres puntos en el header (junto a `ShipmentStatusBadge`, no una barra fija
  al pie) que abre directo un modal con motivo opcional (`reason`, máx 500 caracteres,
  persistido en el historial vía `GET /shipments/:id/events`, AC5) y advertencia de
  irreversibilidad — reusa el mismo armado de modal que el "Rechazar" del receptor en
  vez de `Alert.alert` (que no admite input de texto). Sin menú intermedio de
  opciones: hoy es la única acción del emisor, se agrega ese paso solo si se suma una
  segunda.
  **Feedback tras probarlo (mismo día, dos rondas)**: la primera versión sí era una
  barra fija al pie, mismo patrón que `ReceiverActionsBar` — el usuario la rechazó
  ("esa franja debería estar libre, no es para un botón como cancelar") y pidió
  combinarla con el header. La segunda versión movió el ícono al header pero lo hacía
  abrir el modal de cancelación directo — el usuario también la rechazó ("tiene tres
  puntitos pero abre el modal directo, no es intuitivo") y pidió un desplegable real
  anclado debajo del ícono (mismo lenguaje que el menú "..." de WhatsApp/Telegram: una
  lista de opciones, hoy con una sola fila "Cancelar envío", pensada para sumar
  acciones futuras sin rehacer el patrón). El modal de confirmación ya no se cierra
  ante un error (antes sí): al vivir el `ErrorBanner` ahora adentro del propio modal,
  cerrarlo escondería el mensaje — el usuario ve el error sin perder el motivo ya
  escrito y reintenta desde ahí.
  - **Ancla del menú con offset fijo, no `measureInWindow`**: se evaluó medir la
    posición real del ícono en runtime (patrón ya usado en
    `publish-shipment-button.tsx`), pero su callback nunca se dispara en el entorno de
    test de RNTL (`jest-expo` no lo simula) — el menú jamás habría abierto en los
    tests. Como el ícono siempre vive en la misma fila del header, alcanza con un
    offset constante (`insets.top + 64` / `right: 20`) vía `useSafeAreaInsets()`, sin
    depender de medición nativa.
  - **Tercera ronda de feedback (mismo día)**: la primera versión del desplegable era
    una card plana (`bg-bg` + `border-border` + `shadow-lg` de NativeWind) — "se ve
    berreta", pidió "algo más pulido o nativo". Se probó primero el mismo lenguaje
    "glassy" de `FloatingTabBar` (MOVO-78, `BlurView` + sombra nativa) para no sumar
    una dependencia nativa nueva sin dev client — pero para entonces el proyecto ya
    tenía uno andando (ver abajo), así que se terminó reemplazando por completo.
  - **Cuarta ronda (mismo día): `@react-native-menu/menu` reemplaza todo el
    desplegable casero.** Con dev client disponible, se instaló `MenuView`
    (`UIMenu` nativo de iOS 14+ / `PopupMenu` de Android, sin config plugin de Expo —
    autolinking puro) en vez de seguir afinando CSS de un `Modal` a mano. Resuelve
    gratis el problema de anclaje que antes forzó el offset fijo
    (`isAnchoredToRight`, sin `measureInWindow` ni `insets.top` a mano) y el estilo
    "destructivo" de "Cancelar envío" (`attributes: { destructive: true }`, rojo
    automático en iOS; `titleColor`/`imageColor` explícitos para Android, que no
    tiene ese atributo nativo). El modal de confirmación (con el campo de motivo)
    sigue siendo un `Modal` de RN propio — un menú nativo no admite un input de
    texto libre adentro.
    - **`MenuView` no expone `disabled`**: el ícono se deshabilita envolviéndolo en
      un `View` con `pointerEvents="none"` + opacidad 0.5 durante la mutación, en vez
      de una prop nativa que no existe.
    - **Requiere reconstruir el dev client** (no alcanza con `npm install`): es un
      módulo nativo con código Swift/Kotlin, autolinkeado recién en el próximo
      `expo prebuild`/build nativo — la instalación de JS por sí sola no lo activa
      en un dev client ya instalado en el dispositivo.
    - **Tests: mismo criterio que `time-window-picker.test.tsx` (`DateTimePicker`,
      MOVO-83)**: el menú nativo no tiene representación en el árbol de React (lo
      dibuja SwiftUI/Android, no JS) — `jest.mock("@react-native-menu/menu")`
      reemplaza `MenuView` por un mock liviano que renderiza cada `action` como una
      fila tocable y dispara `onPressAction` con el mismo `nativeEvent.event` que el
      componente real, en vez de intentar simular la apertura del menú nativo.
- **`isSender`/`showSenderActions` en `shipments/[id].tsx`**: análogo a
  `isReceiver`/`showReceiverActions`, mutuamente excluyente por construcción (un
  usuario no puede ser emisor y receptor del mismo envío). Visible solo cuando
  `canCancelShipment(shipment.status)` (nueva en `shipment-format.ts`) es `true` —
  los 3 estados sin fondos confirmados (`awaiting_receiver_confirmation`,
  `published`, `assignment_pending`). No se muestra ningún botón en `assigned` ni en
  estados terminales: exponer una acción que el backend siempre va a rechazar con 409
  no aporta nada.
- **Mapeo de errores con dos 409 distintos**: `SHIPMENT_CANCELLATION_PENALTY_NOT_SUPPORTED`
  (mensaje específico, "ya tiene un transportista asignado") vs.
  `SHIPMENT_INVALID_TRANSITION` (genérico, "ya no se puede cancelar") — el primero no
  debería alcanzarse desde el botón visible, pero puede darse por una carrera real (el
  envío pasa a `assigned` entre que se cargó la pantalla y se toca cancelar); ambos
  disparan `onRefetch?.()`, mismo criterio que el 409 de `ReceiverActionsBar`.
- **`useCancelShipment` en `use-shipments.ts`**, mismas 4 invalidaciones de query que
  `useAcceptShipment`/`useRejectShipment`.
- **Fuera de alcance, ya documentado como limitación aceptada del lado backend**:
  cancelar desde `assigned` con penalización y la liberación del hold de MercadoPago
  siguen bloqueados por `svc-payments` (hoy un stub sin holds/capture reales) — no se
  tocó nada de eso acá, el botón simplemente no se ofrece para ese estado.

### Ajuste post-feedback: labels y tonos de `ShipmentStatusBadge`

Mismo día que el punto anterior — el usuario notó que algunos labels de
`shipmentStatusLabel` eran largos para una pill (`"Rechazado por el receptor"`, 26
caracteres) y que los tonos de `shipmentStatusTone` (`src/lib/shipment-format.ts`) no
comunicaban nada consistente: dos etapas bien distintas del ciclo de vida —
`awaiting_receiver_confirmation` (esperando al receptor) y `assignment_pending`
(buscando transportista, ya confirmado) — compartían el mismo amarillo, y `disputed`
(todavía resoluble) compartía el rojo de los dos únicos estados terminales fallidos
(`cancelled`/`rejected_by_receiver`).

- Labels acortados sin perder claridad: `"Esperando receptor"`, `"Rechazado"`,
  `"Sin asignar"`, `"Asignado"` (antes 22-26 caracteres, ahora máx. 19).
- Tonos reagrupados por lo que debe transmitirle al usuario, no por severidad
  genérica: `warning` queda solo para los dos estados que esperan una acción de
  alguien (`awaiting_receiver_confirmation` del receptor, `disputed` en revisión);
  `assignment_pending` pasa a compartir `info` con `assigned`/`in_transit` como
  progreso automático del camino feliz; `danger` queda reservado a los dos terminales
  fallidos de verdad.
- Sin tono nuevo en `tailwind.config.js` — se reordenó dentro de la misma paleta de 5
  tonos que ya existía (`success`/`warning`/`danger`/`info`/`neutral`), evitando el
  costo de una escala de color nueva (7 pasos, luz+oscuro) para un solo estado.

### `useSheetAnimation` (`src/hooks/use-sheet-animation.ts`) — fix transversal de animación en todos los sheets del pie de pantalla

Bug reportado por el usuario, presente en **todos** los sheets con overlay oscuro +
hoja inferior del repo (no solo MOVO-29): `animationType="slide"` de RN `Modal` anima
TODO el contenido del modal como una sola pieza, así que el overlay se deslizaba desde
abajo pegado a la hoja en vez de solo aparecer — no es el comportamiento de ningún
bottom sheet real (iOS/Android/Material: el overlay hace fade, solo la hoja se
desliza).

- **Alcance**: se aplicó a los 5 sheets que de verdad tienen ese patrón (overlay +
  hoja parcial) — `sender-actions-bar.tsx`/`receiver-actions-bar.tsx` (modales de
  cancelar/rechazar), `select-field.tsx`, `edit-address-sheet.tsx`, el sheet de
  filtros de `app/(app)/shipments/index.tsx`. **No** se tocaron
  `address-search-sheet.tsx` ni `confirm-add-address-sheet.tsx`: son pantallas
  completas sin overlay (`transparent` ausente), el bug no aplica ahí — deslizar todo
  de una pieza ahí sí es lo correcto.
- **`Modal` en sí no anima nada** (`animationType="none"`) — el fade del overlay y el
  slide de la hoja se manejan a mano con Reanimated, un único progreso compartido (0
  cerrado, 1 abierto) para que abrir/cerrar se sienta como una animación coordinada,
  no dos independientes. `isMounted` (no el `visible` del caller) es lo que se le pasa
  al `Modal`, para demorar el desmontaje real hasta que termina la animación de
  cierre.
- **El open se demora un frame (`requestAnimationFrame`) antes de arrancar
  `withTiming`** (fix de feedback: la primera versión sin este delay se veía menos
  fluida en dispositivo — montar el `Modal` nativo de RN no es instantáneo, así que el
  progreso ya iba adelantado para cuando el `Modal` terminaba de presentarse, y la
  hoja "saltaba" a mitad de camino en vez de deslizarse fluida desde abajo). El cierre
  no lo necesita, arranca con el `Modal` ya montado.
- **Estructura por archivo**: un `Animated.View` (`StyleSheet.absoluteFill` +
  `backdropStyle`, opacity-only) para el overlay, envolviendo el `Pressable` de cerrar
  (mismo testID que antes); un `View pointerEvents="box-none"` posicionando la hoja
  al pie (para que el espacio vacío arriba de la hoja no tape el overlay) con un
  `Animated.View` interno (`sheetStyle`, solo `translateY`) para el contenido. En
  `select-field.tsx` esto además permitió sacar el truco de `onPress={(e) =>
  e.stopPropagation()}` que tenía el `Pressable` de contenido (ya no anidado dentro
  del `Pressable` del backdrop, son hermanos).
- **Tests sin cambios de comportamiento**: `isMounted` sigue reflejando el `visible`
  real de forma síncrona en el mismo ciclo de test (el mock oficial de
  `react-native-reanimated`, `test/mocks/reanimated-setup.js`, resuelve `withTiming`
  sincrónicamente) — ningún test depende de los valores animados en sí (`opacity`/
  `translateY`), solo de qué contenido está montado.

### MOVO-141 — Wizard "¿Olvidaste tu contraseña?" (mobile, backend MOVO-140)

Activa el link inerte de `login.tsx` ("Recuperar contraseña (próximamente)") y agrega
`app/(auth)/forgot-password.tsx`: wizard de 3 pasos (identificador → OTP → contraseña
nueva) sobre el contrato de `POST /auth/forgot-password`/`verify-reset-otp`/
`reset-password` (MOVO-140, `PR #108`, ya en `develop`).

- **El AC3 del ticket (extraer la grilla de OTP de `register.tsx`) ya no aplicaba**:
  esa extracción se hizo en MOVO-135 (`components/ui/otp-input.tsx`/`otp-step.tsx` +
  `src/hooks/use-otp-cooldown.ts`). Esta US solo reusa esos componentes compartidos,
  igual que `change-phone.tsx`/`change-email.tsx`/`verify-email.tsx`.
- **`src/hooks/use-password-reset.tsx` es un hook plano, no un `Context`** como
  `use-registration.tsx`: el flujo entero vive y muere en una sola pantalla, sin
  resumibilidad entre sesiones que justifique un Provider. Mismo *shape* de acciones
  (`async () => {ok, ...}` + `errorBanner` compartido) para no repetir `try/catch` en
  el screen.
- **`OtpInput`/`OtpStep` ganaron `firstBoxAutoComplete`** (default `"sms-otp"`,
  compatible con todos los callers existentes): el AC4 pide que el canal `"email"` no
  dispare el autofill de SMS en la primera casilla — antes estaba hardcodeado.
- **Un código vencido (`422 AUTH_OTP_EXPIRED`) vuelve al paso 0**, uno incorrecto
  (`401 AUTH_OTP_INVALID`) se reintenta en el mismo paso — mismo criterio que
  `change-phone.tsx`/`change-email.tsx` (MOVO-135).
- **AC7 (token de reset vencido/usado)**: en vez de una segunda `PrimaryButton`
  secundaria (patrón inexistente en el repo), el botón único del paso 3 cambia su
  label/acción a "Volver a empezar" cuando `resetPassword` devuelve `401
  AUTH_OTP_INVALID` sobre el `passwordResetToken` — reinicia el hook y vuelve al
  paso 0.
- **`login.tsx` gana su primer aviso de éxito post-navegación**: `router.replace`
  manda `{ passwordReset: "1" }` como param, y `login.tsx` lo lee con
  `useLocalSearchParams` para mostrar `SuccessBanner` (MOVO-136, ya existente) — no
  había ningún mecanismo de éxito post-navegación en esa pantalla todavía.
- Sin selector de canal en el paso 1 (AC2) y copy que nunca afirma que la cuenta
  existe (AC5): la misma frase "si el dato corresponde a una cuenta de Movo" para los
  dos canales, solo cambia "por SMS"/"a tu email".

Tests nuevos: `test/forgot-password-screen.test.tsx` (los 3 pasos, copy/autofill por
canal, código incorrecto vs. vencido, reinicio ante token vencido, navegación final
sin sesión), `test/login-screen.test.tsx` (nuevo — no existía ningún test de esta
pantalla; cubre el link y el `SuccessBanner`), casos agregados a
`test/otp-input.test.tsx` (`firstBoxAutoComplete`). 67 suites / 511 tests en
`movo-mobile`, `tsc --noEmit` limpio (aparte del ruido preexistente y no relacionado
de `.expo/types/router.d.ts`, gitignoreado — se regenera al levantar el dev server).

Pendiente / fuera de alcance: `.env.example` sin cambios (no hay env vars nuevas del
lado mobile); probado contra `svc-users` real de punta a punta con
`SMS_PROVIDER=console`/`EMAIL_PROVIDER=console` queda para QA manual, no verificable
en este entorno.

### Pendientes de este paquete

- **`eas init`/development build real en dispositivo**: pendiente para probar de
  punta a punta el SDK de Didit (KYC) y push notifications (MOVO-107) fuera de Expo Go.
- Backend de **MOVO-106** (registro de push token del lado servidor) no existe
  todavía — MOVO-107 está implementado contra su contrato propuesto.
- **AC5 (aviso en foreground) sin componente nuevo**: se configura
  `Notifications.setNotificationHandler({ shouldShowAlert: true, ... })` a nivel de
  módulo — usa el banner nativo del SO incluso con la app abierta. No hay ningún
  banner auto-dismiss reusable en el repo (`ErrorBanner` es persistente a propósito),
  así que construir uno hubiera sido alcance extra no pedido por el AC.
- **`httpClient` no exponía `delete`** (`HttpMethod` ya incluía `"DELETE"` pero el
  objeto exportado no lo usaba) — se agregó `httpClient.delete<T>(path, body, headers)`,
  mismo shape que `post`/`patch`, porque el contrato de MOVO-106 manda `{ deviceId }`
  en el body del `DELETE`.
- **`expo-crypto` en vez del paquete `uuid`** para generar el `deviceId`: evita el
  polyfill de `crypto.getRandomValues` que `uuid` necesita en RN/Hermes — decisión
  tomada con el usuario junto con las dos anteriores.
- **AC4 (des-registro en logout)**: `auth-store.ts#logout()` llama a
  `unregisterCurrentDevice()` **antes** de `clearSession()` (necesita el accessToken
  todavía en memoria para el header `Authorization`), envuelto en `try/catch` propio
  además del que ya trae la función internamente — mismo criterio de "un paso
  secundario nunca bloquea salir de la cuenta" que ya usa esa función con
  `authClient.logout`.
- **`eas init` ya se había corrido** (proyecto "movo-mobile", org "movosend"), pero el
  `projectId` nunca quedó commiteado — vivía en un `app.json` local de una rama
  anterior, reemplazado por `app.config.js` en MOVO-73 sin portar el valor, y se perdió
  al cambiar de rama. Repuesto acá: `owner: "movosend"` +
  `extra.eas.projectId: "077f9c8d-cb66-4772-a76c-34e4548290e7"` en `app.config.js`
  (verificado con `npx expo config --type public`, que ahora sí resuelve ambos).
- Mobile de MOVO-120 (proxy de Places en `svc-users`, ver
  `services/movo-svc-users/CLAUDE.md`) no genera/envía todavía un `sessionToken` de
  Places — cuando exista la pantalla de búsqueda de dirección con autocomplete,
  generar un token por sesión de búsqueda y mandarlo en cada `/places/autocomplete` +
  el `/places/details` final.
- **AC7 (Expo Go, aun con `projectId` configurado)**: `Notifications.
  getExpoPushTokenAsync({ projectId })` sigue tirando en Expo Go (no soporta push
  remoto, independientemente del `projectId`) — se atrapa en `push-registration.ts`,
  se loguea y no rompe nada más.
- `app.config.js`: se agregó `"expo-notifications"` al array `plugins` (sin esto
  Android no genera el ícono/sonido de notificación en el build nativo). Sin cambios
  en `.env.example` — el push token de Expo no requiere ningún secret del lado
  cliente, a diferencia de las keys de Google Maps.

### MOVO-113 — Paquete de fixes por bugs en UI y rediseño de Actividad Reciente (`movo-mobile`)

Resuelve el paquete completo de bugs de navegación/KYC y aplica el rediseño de la sección de Actividad Reciente en Inicio (Home).

1. **Rediseño Actividad Reciente (Home)**:
   - Header del card: Label izquierdo + dot verde lima (`bg-lime-500`) con contador de pedidos activos (se oculta automáticamente cuando es 0).
   - Acceso a "Mis Envíos": Fila independiente debajo del card (`ViewAllShipmentsLink`, layout 1-a) con fondo `bg-sub`, borde y chevron.
   - Filas de envíos (`ShipmentRow`, layout 1-b): Iconos de caja con flechas direccionales superpuestas con contorno exterior limpio (↑ lima `#C6F24A` con outline oscuro para emisor, ↓ negra `colors.fg1` para receptor) + timestamp relativo secundario (`formatShipmentRowTime`).

2. **Bugs corregidos**:
   - **Bug 1 (Bucle post-KYC onboarding)**: En `profile-photo.tsx#handleFinish()`, se garantiza la actualización incondicional a `KycStatus.APPROVED` en `authStore` antes de llamar `resetRegistration()`, eliminando condiciones de carrera con los guards de navegación.
   - **Bug 2 (Reinicio de KYC desde Perfil)**: En `app/(auth)/kyc.tsx` y `auth-client.ts`, se unificó la lectura de `kycStatus` cayendo al estado de `authStore` cuando el contexto efímero de registro no está activo, permitiendo consultar el estado real y operar con la sesión autenticada.
   - **Bug 3 (Flash de interfaz de DIDIT)**: En `kyc.tsx` y `license-kyc.tsx`, `phase` y `resultKind` se derivan inmediatamente en `useState` a partir del status existente/params de ruta, eliminando el frame transitorio de la pantalla de intro.
   - **Bug 4 (GO_BACK error en login)**: En `login.tsx` (y `register.tsx`), se evalúa `router.canGoBack()` para ejecutar `router.back()` con la animación nativa estándar cuando hay historial previo, o caer a `router.replace('/')` de forma segura.
   - **Bug 5 (Aceptado en cancelados)**: En `shipment-format.ts`, `receiverConfirmationStatus()` retorna `undefined` ante estados `CANCELLED` y `DISPUTED`, evitando mostrar la pill "Aceptó el envío" en pedidos cancelados por timeout o expiración.
   - **Bug 6 (Banner de KYC en navbar de Home)**: En `home.tsx`, el banner informativo de KYC se movió fuera del `SafeAreaView` del navbar superior al inicio del `ScrollView`, manteniendo el header limpio con solo el saludo.
   - **Bug 7 (Estado residual al cerrar sesión)**: En `auth-store.ts` y `use-registration.tsx`, `clearSession` elimina las claves `pendingRegistration*` de `secureStore` y resetea el contexto en memoria al pasar a `unauthenticated`, evitando que la bienvenida muestre "Continuar verificación".
   - **Bug 8 (Unificación de insignias de verificación en Perfil)**: En `profile.tsx` y `profile-badges.tsx`, se retiró el banner redundante de KYC y se unificaron las insignias de `DNI` y `Licencia` debajo del nombre del usuario (verde `#1F9760` si verificado, rojo `#C22F35` si no verificado, sin fondo de badge).

Tests: 64 suites pasadas / 490 tests totales en verde.

### MOVO-150 — Ofertas recibidas: listado, comparación y elección del transportista (`movo-mobile`)

Frontend de MOVO-17 sobre los endpoints de MOVO-144: el emisor consulta las ofertas recibidas sobre su envío publicado, las compara ordenadas por precio o reputación, visualiza el perfil del transportista y confirma la elección o el rechazo de ofertas puntuales.

- **Punto de acceso en detalle de envío (`OffersBanner`, MOVO-127)**: actualizado para consumir `useShipmentOffers`, mostrando el contador visible *"Ofertas recibidas (N)"* con pill lima interactiva y navegación a `app/(app)/shipments/[id]/offers.tsx`.
- **Pantalla de ofertas (`app/(app)/shipments/[id]/offers.tsx`)**:
  - Control de ordenamiento segmentado: *"Menor precio"* (`sort=price`, default) vs. *"Mejor reputación"* (`sort=rating`).
  - Tarjeta de oferta (`components/shipments/offer-card.tsx`): precio formateado (`formatPriceArs`), fecha de viaje, mensaje opcional, nombre y reputación (`formatReputationScore`, muestra *"Sin calificaciones"* ante ausencia de ratings reales).
  - Consulta de perfil del transportista (`components/shipments/carrier-profile-sheet.tsx`): Bottom Sheet animado (`useSheetAnimation`) con `ProfileAvatar`, `ProfileBadges` y `ProfileStatsRow`.
  - Flujo de elección con confirmación (`ChooseOfferModal`): advierte que las demás ofertas quedan descartadas y el transportista queda seleccionado.
  - Modal de éxito con copy honesto (`ChooseOfferSuccessModal`): refleja que el envío quedó en `assignment_pending` a la espera de la confirmación del pago (MOVO-12), sin prometer falsamente que el envío ya está confirmado.
  - Rechazo puntual de ofertas (`RejectOfferModal`): permite rechazar una oferta puntual manteniendo el envío publicado para recibir nuevas propuestas.
  - Manejo de concurrencia 409: captura conflictos por asignación concurrente u ofertas expiradas, explicando que la propuesta ya no está disponible y disparando el refetch automático de ofertas y detalle.
- **Cliente y hooks (`src/api/offers-client.ts` / `src/hooks/use-offers.ts`)**:
  - `listShipmentOffers` (`GET /shipments/:id/offers`), `acceptOffer` (`POST /offers/:id/accept`) y `rejectOffer` (`POST /offers/:id/reject`).
  - Mutaciones con invalidación de queries de detalle de envío, ofertas y listados de inicio.

Tests: `test/offers-client.test.ts`, `test/offer-card.test.tsx`, `test/offers-banner.test.tsx`, `test/offers-screen.test.tsx`. 70 suites / 530 tests en verde.

### MOVO-162 — "Mis viajes": declarar/editar/cancelar viaje (`movo-mobile`)

Frontend del CRUD de `/trips` (`movo-svc-shipments`, MOVO-161, ya Done/mergeado):
`src/api/trips-client.ts` + `src/hooks/use-trips.ts` (mismo patrón que
`shipments-client.ts`/`use-shipments.ts` — una sola página con `limit: 50` en vez de
scroll infinito, el AC no pide paginación). `app/(app)/carrier/trips/index.tsx`
("Mis viajes", modelada sobre `addresses.tsx`), `new.tsx`/`[id]/edit.tsx` (mismo
`TripForm` compartido, `components/trips/trip-form.tsx`). Punto de entrada nuevo en
el tab "Transportar" (`app/(app)/(tabs)/transport.tsx`, hasta ahora un placeholder
puro de MOVO-78) — mismo criterio de alcance acotado que MOVO-83 con "Enviar": solo
el CTA hacia "Mis viajes", sin rediseñar el tab entero.

Decisiones clave:
- **Origen/destino reusan `AddressField`** (`components/send/address-field.tsx`,
  MOVO-83/121) tal cual — ya estaba desacoplado del store del wizard, así que no hizo
  falta tocarlo.
- **`DepartureDateTimePicker` nuevo** (`components/trips/departure-date-time-picker.tsx`):
  `TimeWindowPicker` no servía (da fecha + una de 3 franjas fijas, pensado para la
  ventana de retiro de un envío) — `departureAt` necesita un instante único real.
  Mismo patrón nativo (Android imperativo/iOS inline), pero con dos filas (fecha +
  hora) combinadas en un único `Date`, sin el gotcha de timezone que sí tiene
  `pickupDate` (acá se trabaja con instantes reales de punta a punta, el backend
  también espera `date-time` ISO completo).
- **`vehicleType` acotado a una lista fija con `SelectField`** (`["Auto", "Camioneta",
  "Moto", "Camión"]`, valor = label tal cual) aunque el backend lo acepta como string
  libre — evita pedirle al usuario texto libre para un dato que en la práctica tiene
  pocas opciones reales.
- **AC4 (bloqueo por paquetes aceptados) sin deep-link a los envíos concretos**: no
  existe ningún endpoint que liste qué envíos están ligados a un viaje (`Offer.tripId`
  sin cablear todavía, ver el fix de backend abajo) — la card bloqueada y la pantalla
  de editar muestran mensaje explicativo, sin botón que prometa una salida que no
  existe. `[id]/edit.tsx` revalida `hasAcceptedPackages` con `useTrip(id)` al cargar
  (defensa contra una carrera real: la lista ya desactualizada cuando se tocó
  "Editar").
- **Gap real encontrado y corregido en el backend en el camino** (`services/
  movo-svc-shipments`, commit separado): `trip-repository.ts` contaba cualquier
  oferta `accepted` sin mirar si el envío al que apunta seguía vivo — un viaje
  quedaba bloqueado para siempre aunque el emisor cancelara el envío asociado. Ver
  `services/movo-svc-shipments/CLAUDE.md` (entrada de MOVO-161) para el detalle
  completo, incluido el gap más grande encontrado en el camino: **nada en el código
  escribe `Offer.tripId` todavía** (ni el body de `POST /shipments/:id/offers` lo
  acepta, ni existe ninguna pantalla mobile de "hacer una oferta") — así que
  `hasAcceptedPackages` nunca es `true` a través del producto real hoy. Documentado
  como pendiente, candidato natural para cuando se implemente la sub-issue "vista de
  paquetes compatibles con el viaje" que este mismo ticket excluye de su alcance.

Tests: `test/trips-client.test.ts`, `test/trip-form.test.tsx`,
`test/departure-date-time-picker.test.tsx`, `test/my-trips-screen.test.tsx`,
`test/new-trip-screen.test.tsx`, `test/edit-trip-screen.test.tsx`,
`test/transport-screen.test.tsx`. 84 suites / 605 tests en verde, `tsc --noEmit`
limpio (aparte del ruido preexistente y no relacionado de `test/shipment-format.test.ts`).

Pendiente / fuera de alcance: vista de paquetes compatibles con el viaje (sub-issue
hermano, explícito en el ticket); pantalla de "hacer una oferta" del lado
transportista (no existe en ningún lado del mobile todavía, ver el gap de `tripId`
arriba).

### MOVO-153 — Calificación post-entrega de la contraparte (`movo-mobile`)

Frontend de calificación y reputación sobre los endpoints de MOVO-146: permite a las partes intervinientes de un envío entregado (`DELIVERED`) calificar y editar su calificación dentro de una ventana de 72 horas.

- **Regla de negocio de interacción física (ajuste sobre el texto inicial del ticket)**:
  - A diferencia de la descripción original de la US (*"el emisor califica a transportista y receptor..."*), se determinó que solo se califica ante interacción física directa:
    - **Emisor**: Califica únicamente al transportista (quien retira el paquete).
    - **Receptor**: Califica únicamente al transportista (quien entrega el paquete).
    - **Transportista**: Califica a ambas partes (al emisor por el retiro y al receptor por la entrega).
    - Emisor y receptor no se califican entre sí al no tener contacto directo.
- **Componentes UI**:
  - **`components/ui/star-rating-input.tsx`**: Selector de 1 a 5 estrellas interactivo y de solo lectura con accesibilidad (`role="radio"` / `accessibilityLabel`), touch targets amplios con `hitSlop` y animaciones táctiles.
  - **`components/shipments/rating-sheet.tsx`**: Bottom sheet animado (`useSheetAnimation`) que muestra avatar y nombre de la contraparte, selector de estrellas, etiqueta cualitativa ("Regular", "Muy buena", "Excelente"), campo de texto para comentario opcional (máx 500 caracteres con contador), botón de envío o guardado de edición, y banner de error ante fallas del servidor.
  - **`components/shipments/shipment-ratings-card.tsx`**: Sección en la tab de detalles del envío entregado. Resuelve contrapartes según rol logueado, calcula la expiración de la ventana de 72 horas desde `deliveredAt`, muestra advertencia si el envío está en disputa (`status === DISPUTED`), y provee botones de "Calificar" o "Editar".
  - **`components/shipments/timeline-section.tsx`**: Renderiza las calificaciones recibidas y emitidas en la línea de tiempo del envío cuando está entregado.
  - **`app/(app)/shipments/[id].tsx`**: Integración en pantalla de detalle al final de la pestaña, mostrando la sección de calificaciones ante estado `DELIVERED` y banner de éxito (`SuccessBanner`) al registrar o editar calificaciones.
- **Cliente y hooks (`src/api/ratings-client.ts` / `src/hooks/use-ratings.ts`)**:
  - `createRating` (`POST /shipments/:id/ratings`), `updateRating` (`PATCH /shipments/:id/ratings/:rateeId`), `listShipmentRatings` (`GET /shipments/:id/ratings`).
  - React Query invalidation sobre `["shipments", "ratings", shipmentId]` y detalle del envío.
- **Traducciones y Push (`error-messages.ts` / `use-push-notifications.ts`)**:
  - Mapeo amigable de errores: `SHIPMENT_RATING_WINDOW_EXPIRED`, `SHIPMENT_RATING_DISPUTE_ACTIVE`, `SHIPMENT_RATING_ALREADY_EXISTS`, etc.
  - Soporte para navegación push con `rating_received`.

Tests: `test/ratings-client.test.ts`, `test/star-rating-input.test.tsx`, `test/rating-sheet.test.tsx`, `test/shipment-ratings-card.test.tsx`, actualizados `test/timeline-section.test.tsx` y `test/shipment-detail-screen.test.tsx`.

### MOVO-148 — Tab Transportar: listado de envíos disponibles cerca (`movo-mobile`)

Reemplaza el placeholder de `app/(app)/(tabs)/transport.tsx` (MOVO-78) por el listado
real de `GET /shipments/available` (MOVO-142, ya en `develop`): radio configurable
(10/25/50/100km, persistido), cascada de origen GPS → dirección default → selector
manual, gating explícito por KYC de identidad (`403 CARRIER_NOT_VERIFIED`), badge de
`hasMyOffer`, paginado con scroll infinito + pull-to-refresh (mismo patrón que "Mis
Envíos", MOVO-127).

- **`src/hooks/use-transport-origin.ts` nuevo**: resuelve el origen con la cascada del
  AC2 — GPS (`useMyLocation`, ya existente) → dirección default de `useAddresses()`
  (`Address.isDefault`) → `needsManualPick` para que la pantalla abra
  `AddressSearchSheet` (el mismo selector del wizard de envío, ya desacoplado en
  MOVO-121). Una selección manual siempre gana sobre GPS/default, así el mismo
  mecanismo sirve también para "Cambiar ubicación" en el header, sin estado aparte.
- **AC9 (abrir el detalle desde una card) resuelto con una pantalla propia, extraída a
  MOVO-166**: la primera versión reusaba `shipments/[id].tsx` (detalle de emisor/
  receptor), pero esa pantalla solo conoce esos dos roles — un transportista caía en
  la rama "no soy receptor, debo ser emisor" y veía "Receptor" en vez de "Emisor", más
  el banner de ofertas con copy del emisor. Se separó a `app/(app)/transport/[id].tsx`
  (MOVO-166, branch propia) en vez de sumar un tercer rol a la pantalla compartida.
- **Distancia total del viaje en la card** (pedido explícito del usuario tras revisar
  el resultado): `haversineDistanceKm`/`formatTripDistanceKm` nuevas en
  `shipment-format.ts` para una aproximación en línea recta client-side — evita
  pegarle a la Google Routes API por cada card de un listado (cuota/costo, ADR-015).
  La distancia real por calle en el detalle (`formatRouteDistanceKm`) queda del lado
  de MOVO-166, que sí puede reusar la ruta que `RouteMapCard` ya pide para el mapa.
- **Bug encontrado por el usuario probando en dispositivo, corregido en backend**:
  `GET /shipments/available` seguía devolviendo envíos con la ventana de retiro ya
  vencida (sin sweep de expiración para `published`, a diferencia de la confirmación
  del receptor). `isPickupWindowExpired()` nueva en `shipment-format.ts` filtra esos
  ítems client-side sobre las páginas ya cargadas (mismo criterio ya aceptado en "Mis
  Envíos" para filtros sobre datos paginados) — mitigación inmediata mientras el fix de
  fondo (barrido nuevo en `movo-svc-shipments`, ver su CLAUDE.md) hace lo mismo del
  lado del servidor.
- **`zoneLabelFromAddress()` (`shipment-format.ts`) con dos fuentes distintas según el
  origen**: para GPS/manual, hereda de un `formattedAddress` de Google (heurística
  sobre comas, best-effort — `/geocode/reverse` no devuelve componentes
  estructurados); para una dirección guardada, usa directo el campo `city` de
  `Address` (estructurado) en vez de aplicarle la misma heurística a `Address.label`
  (texto libre del usuario, a veces literalmente la calle) — bug encontrado en device,
  el label no tiene la forma de una dirección completa.
- Radio persistido con el wrapper genérico `secureStore` ya existente (`src/lib/
  secure-store.ts`, key `movo.transportRadiusKm`) — se evitó sumar una dependencia
  nueva (tipo AsyncStorage) para una sola preferencia de UI no sensible.

Tests nuevos: `test/transport-screen.test.tsx`, `test/available-shipment-card.test.tsx`,
`test/use-transport-origin.test.ts`, `test/use-transport-radius.test.ts`,
`test/is-pickup-window-expired.test.ts`. `tsc --noEmit` limpio.

Pendiente / fuera de alcance: el detalle del envío al tocar una card (AC9) y "hacer una
oferta" quedaron en MOVO-166/MOVO-149 respectivamente, branches separadas; badge
`hasMyOffer` sin poder probarse a mano de punta a punta hasta que MOVO-149 exista
(cubierto solo por test unitario contra el shape de la respuesta); no probado en
device con una cuenta sin KYC de identidad aprobado (estado de gating) ni con más de
una página de resultados (paginación/scroll infinito).

### MOVO-166 — Detalle del envío disponible para el transportista, solo lectura (`movo-mobile`)

Extraído de MOVO-149 (refinamiento: ese ticket queda enfocado solo en la acción de
ofertar) — construido sobre la branch de MOVO-148 (AC9: tocar una card del tab
Transportar necesitaba algún destino).

- **Pantalla nueva `app/(app)/transport/[id].tsx`, separada de `shipments/[id].tsx`**
  (esa es la vista de emisor/receptor, MOVO-127/131 — solo conoce esos dos roles). Un
  transportista que descubre un envío ajeno no es ninguno de los dos; reusar esa
  pantalla lo trataba como si fuera el emisor (mostraba "Receptor" en vez de "Emisor",
  y el banner de ofertas con copy "Aún no tenés ofertas" pensado para quien espera que
  le oferten). La pantalla nueva muestra siempre **Emisor y Receptor**, en ese orden
  fijo — sin cálculo de rol, a esta ruta solo se llega desde afuera del envío — y sin
  ninguna acción de escritura (ni aceptar/rechazar/cancelar/ofertar): "hacer una
  oferta" es MOVO-149, que se apoya en esta pantalla.
- **Distancia real por calle** (`formatRouteDistanceKm`, `route.distanceMeters`): la
  pantalla ya pide `GET /shipments/route` para dibujar el mapa (`RouteMapCard` usa
  `useShipmentRoute` internamente, MOVO-123) — se llama al mismo hook una segunda vez
  acá arriba con los mismos `pickup`/`delivery`, TanStack Query dedupea por query key
  así que no dispara un segundo request. Mientras la ruta no resolvió o falla, cae a
  la aproximación en línea recta de MOVO-148 (`formatTripDistanceKm`).
- **Errores con copy propio, no el de `shipments/[id].tsx`**: `403` → "Este envío ya
  no está disponible" (cambió de estado entre que se listó y se abrió la card — no
  "no te pertenece", que asume que el caller es parte del envío), `404` → "Este envío
  no existe".
- Reusa tal cual (sin cambios) `RouteMapCard`, `PackageCard`, `CounterpartCard`,
  `ShipmentStatusBadge`, `ShipmentDetailSkeleton` del detalle existente.

Tests nuevos: `test/transport-detail-screen.test.tsx` (skeleton, error 403/404 con el
copy específico, Emisor y Receptor, distancia real vs. aproximación). `tsc --noEmit`
limpio (aparte del error preexistente y no relacionado de `test/shipment-format.test.ts`
en `develop`, ver MOVO-148).

Pendiente / fuera de alcance: "hacer una oferta" (MOVO-149, que ahora depende de esta
pantalla); no probado en device (branch separada de MOVO-148, a integrar).

### MOVO-149 — Detalle del envío disponible y creación de la oferta (`movo-mobile`)

Frontend de MOVO-23: el transportista abre un envío disponible y oferta un precio neto a cobrar, o retira una oferta activa previa. Bloqueado por MOVO-143 (backend `POST /shipments/:id/offers` y retiro) y apoyado sobre la pantalla de detalle `app/(app)/transport/[id].tsx` (MOVO-166).

- **Hoja de creación de oferta (`components/transport/create-offer-sheet.tsx`)**:
  - Prellenado del monto neto que el transportista quiere cobrar a partir del `suggestedPriceArs` del envío (editable) y fecha del viaje con la fecha de retiro.
  - Lo que se envía al servidor es el neto (`priceOfferedArs`), el backend calcula y persiste el bruto con su comisión (AC2/AC3 de la US). Desglose devuelto por la API (`priceNetArs`, `commissionAmountArs`, `priceOffered`) mostrado en pantalla de éxito sin recalcular comisiones en el cliente.
  - Validación de monto: soporte para coma `,` y punto `.`, límite estricto de hasta 2 posiciones decimales desde el ingreso, y borde rojo (`border-danger-500`) con icono X (`#E5484D`) y mensaje *"Ingresá un monto válido"* ante entradas no numéricas, múltiples comas o `<= 0`.
  - Mapeo de errores de negocio vía `src/lib/error-messages.ts`: 409 (`SHIPMENT_NOT_AVAILABLE_FOR_OFFER`), 409 (`OFFER_DUPLICATE_ACTIVE`), 422 (`OFFER_DATE_OUT_OF_RANGE`) y 403 (`CARRIER_NOT_VERIFIED`, falta KYC de identidad con CTA directo a `/kyc`).
- **Integración en detalle de transportista (`app/(app)/transport/[id].tsx`)**:
  - Detección de oferta activa vía `useMyOffers({ status: OfferStatus.PENDING })`: si ya existe, muestra la card *"Tu oferta activa"* con monto, fecha y mensaje enviado, y reemplaza la acción por *"Retirar oferta"* con confirmación modal (`Alert.alert`).
- **Listado y confirmación (`app/(app)/(tabs)/transport.tsx`)**:
  - Al ofertar exitosamente, navega al listado con `offerCreated=1` mostrando un `SuccessBanner`.
  - Actualización optimista de cache en `useCreateOffer` y `useWithdrawOffer`: marca inmediatamente `hasMyOffer: true/false` sobre la query `["shipments", "available"]`, reflejando el badge *"Ya ofertaste"* en la card sin recargar a mano.
- **Cliente de ofertas y hooks**: `src/api/offers-client.ts` (`createOffer`, `withdrawOffer`, `listMyOffers`) y `src/hooks/use-offers.ts` (`useCreateOffer`, `useWithdrawOffer`, `useMyOffers`).

Tests nuevos y actualizados: `test/create-offer-sheet.test.tsx` (apertura con prellenado, envío exitoso, desglose de respuesta, errores 409/422/403 KYC, validación con icono X y límite de 2 decimales), `test/transport-detail-screen.test.tsx` (card de oferta activa previa y flujo de retiro con confirmación), `test/transport-screen.test.tsx` (banner de éxito y actualización de badge), `test/offers-client.test.ts`. 87/87 suites pasadas, 643/643 tests en `movo-mobile`. `tsc --noEmit` limpio.

### MOVO-163 — Feed de paquetes compatibles con el viaje declarado (`movo-mobile`)

Extiende el tab Transportar (MOVO-148) con un filtro por viaje declarado, sobre el
matching geométrico de MOVO-161 (`GET /trips/:id/matches`, ya Done). **Corrección
sobre el ticket original**: el path `app/(app)/carrier/feed.tsx` que mencionaba nunca
existió — el feed real a extender es `app/(app)/(tabs)/transport.tsx` (MOVO-148/162).

- **`transport.tsx` pasa a tener dos modos según `?tripId=`** (desde "Mis viajes"):
  sin `tripId`, exactamente el comportamiento de MOVO-148 (`useAvailableShipments`,
  GPS/radio); con `tripId`, fuente `useTripMatches` nueva (`use-trips.ts`, mismo
  patrón `useInfiniteQuery` que su par), sin selector de radio ni cascada de
  origen/GPS — decisión de alcance acordada con el usuario, el AC no pedía un
  selector de radio para este modo. Header propio ("Filtrado por viaje: X → Y · Ver
  todos") reemplaza la fila de zona/radio; el resto (skeleton, gating KYC, error,
  `AvailableShipmentCard`, paginación, pull-to-refresh) se reusa sin tocar.
- **`useTransportOrigin` ganó un parámetro `enabled`**: sin esto, entrar al feed
  filtrado por viaje disparaba igual el pedido de permiso de GPS (el hook llamaba a
  `resolveCurrentLocation()` en un efecto sin condición) — el modo viaje no depende en
  absoluto de la ubicación del usuario.
- **`TripCard` (`components/trips/`) gana un `onPress`**: toda la card es pressable
  (abre el feed filtrado), editar/eliminar quedan como `Pressable`s anidados sin
  bubbling — mismo criterio que `ContactRow` (MOVO-139).
- **Reparto de tipos**: `TripMatchesParams`/`TripMatchesResponse` se declararon como
  `type` (no `interface`) en `trips-client.ts` — un `interface` sin index signature no
  es asignable al parámetro `Record<string, ...>` de `httpClient.get`, mismo gotcha
  que ya evita el resto de los métodos del archivo con tipos anónimos/`type`.

**Extensión de alcance acordada con el usuario durante el refinamiento (AC6/AC7 del
ticket, no en la redacción original)**: comportamiento "tipo Uber" — avisar de
paquetes compatibles con un viaje activo sin que el transportista tenga que abrir el
feed a mano. AC6 pasó por varias rondas de feedback viéndolo corrido en simulador
antes de asentarse; acá solo el estado final (el historial completo de iteraciones
vive en el PR, no acá).

- **AC6, foreground (100% mobile)**: `use-active-trip-match-alert.ts` (nuevo) vigila
  el primer viaje `active` de `useMyTrips()` con un polling propio (`AppState` +
  `setInterval`, no `refetchInterval` de React Query — el repo no tiene
  `focusManager` de RN configurado), pausado en background y con un refetch
  inmediato al volver a foreground. Expone **todos** los matches pendientes
  (`hasMyOffer: false`) del viaje vigilado, no uno solo (`TripMatchAlert.shipments:
  AvailableShipment[]`) — vuelve a alertar ya en la primera respuesta si hay algo
  pendiente (a propósito: no siembra en silencio), y tras un `dismiss()` el aviso
  completo queda pospuesto 5 min (un solo timestamp por viaje, no por envío) antes de
  poder reaparecer — tanto por ese snooze como por relanzar la app (el snooze vive en
  memoria, se resetea solo). Un envío deja de listarse cuando `hasMyOffer` pasa a
  `true` o deja de venir en la respuesta. **Delay de arranque de 10s** (feedback:
  "que no sea tan agresivo"): el primer aviso de cada sesión no puede mostrarse hasta
  que pasen `TRIP_MATCH_STARTUP_DELAY_MS` desde que se monta el hook (una vez por
  apertura de la app, no reinicia con cambios de viaje activo) — no retrasa el
  polling en sí ni el snooze tras un descarte.
- **`TripMatchAlertBanner`** (nuevo, `components/trips/`) es el primer overlay global
  del repo — a diferencia de `SuccessBanner`/`ErrorBanner` (embebidos en una
  pantalla), tiene que verse sin importar dónde esté el usuario: montado como
  hermano superpuesto del `<Stack>` en `app/(app)/_layout.tsx`, dentro de un `Modal`
  transparente + `useSheetAnimation` (mismo patrón que `ReceiverActionsBar`,
  MOVO-131) con un backdrop propio que blurrea y oscurece toda la pantalla de atrás
  — una v1 sin `Modal` (un `View` absoluto sin backdrop) dejaba el contenido de la
  pantalla de atrás sangrando alrededor de la card, muy amontonado. Con más de un
  match pendiente, se recorren con un carrusel horizontal swipeable (mismo patrón de
  `FlatList` paginado que `PhotoViewerModal`, MOVO-127 — `pagingEnabled` +
  `getItemLayout` + `onMomentumScrollEnd`, contador "N/M"), reusando
  `AvailableShipmentCard` tal cual (AC3) en vez de duplicar esa UI. Sin botones
  "Aceptar"/"Rechazar" (una versión intermedia los tuvo y se sacaron): decidir un
  envío sigue siendo, como en el resto de la app, entrar a su detalle y ofertar ahí
  (MOVO-149) — el botón "Ver envío" navega ahí mismo, solo hace más obvia la acción
  de tocar la card. Se oculta (sin descartar el `alert`) mientras se está viendo el
  detalle de un envío (`/transport/:id`, vía `usePathname()`) — reaparece solo al
  volver a cualquier otra pantalla, sin re-consultar el backend.
- **`AvailableShipmentCard` ganó dos props, `bare` e `interactive`** (ambos default
  igual al comportamiento previo, sin tocar su uso en `transport.tsx`/AC9 de
  MOVO-148): `bare` saca su propio borde/fondo (dentro del aviso se leía como una
  "card dentro de otra card", feedback del usuario, "la card de adentro se ve
  rara" — un separador `border-t` entre el header y el carrusel cumple ese rol una
  sola vez); `interactive={false}` hace que tocarla no navegue a ningún lado —
  pedido explícito del usuario, el detalle solo se ve apretando "Ver envío"
  (tocar la card competía con el gesto de swipe del carrusel). "Ver envío" lleva el
  mismo efecto de press que el resto de los botones "principales" del repo
  (`PrimaryButton`, `ReceiverActionsBar`): `active:opacity-80` +
  `Haptics.impactAsync(ImpactFeedbackStyle.Light)`.
- **AC7, background (deep-link mobile, contrato acordado con `MOVO-179`)**:
  `use-push-notifications.ts` generaliza `isShipmentNotificationData`/
  `NAVIGABLE_NOTIFICATION_TYPES` (que asumían que todo tipo navegable tenía
  `shipmentId` y navegaba a `/shipments/:id`) a un `resolveNotificationRoute(data)`
  por tipo, sumando `trip_match` → abre el feed filtrado por `tripId`. El mobile se
  programó contra el payload ya acordado (`{ type: "trip_match", tripId, shipmentId }`)
  sin esperar el merge de `MOVO-179` — mismo criterio que MOVO-108 permitió con
  MOVO-106. `shipmentId` viaja en el payload pero no se usa todavía (no hay forma de
  resaltar una card puntual del feed) — simplificación aceptada, no alcance no pedido.
- **`MOVO-179`** (`[svc-shipments] Push notification al publicarse un envío
  compatible con un viaje declarado`) se creó como sub-issue nuevo bajo MOVO-18,
  bloqueante de MOVO-163 — el disparo real del backend (detectar el match al
  transicionar un envío a `published` y notificar) queda pendiente ahí, no es parte de
  este ticket mobile.
- Simplificaciones aceptadas: con más de un viaje `active` simultáneo, la alerta de
  AC6 solo vigila el primero que devuelve `useMyTrips()` — sin selector de "cuál
  viaje". `?autoOffer=1` en `transport/[id].tsx` (abrir `CreateOfferSheet` sola al
  llegar) se agregó y se revirtió en el camino — quedó sin caller una vez sacados los
  botones Aceptar/Rechazar del aviso, no tenía sentido dejarlo como código muerto.

Tests: `test/use-active-trip-match-alert.test.ts` (alerta ya en la primera
respuesta, excluye `hasMyOffer: true`, desaparece si deja de estar pendiente,
`dismiss()`/snooze de 5 min, reaparece al "relanzar" — hook remontado de cero —,
reset del snooze al cambiar de viaje activo, pausa/resume con `AppState`),
`test/trip-match-alert-banner.test.tsx` (render condicional, singular/plural +
contador N/M, carrusel con una `AvailableShipmentCard` por match, X/backdrop
descartan, oculto mientras `pathname` es `/transport/:id`), casos nuevos en
`test/transport-screen.test.tsx` (modo filtrado por viaje completo),
`test/my-trips-screen.test.tsx` (tap de card navega, editar no dispara también la
navegación), `test/use-push-notifications.test.tsx` (`trip_match` con y sin
`tripId`, cold start), y del carrusel/puntos de página en el propio
`trip-match-alert-banner.test.tsx`, y un caso nuevo en
`available-shipment-card.test.tsx` (`interactive={false}` no navega). 89/89 suites,
674/674 tests en `movo-mobile`. `tsc --noEmit`
limpio (el ruido preexistente de `TRIP_NOT_ACTIVE` en `error-messages.ts` era un
`dist/` desactualizado de `@movo/shared` sin rebuildear — corregido con `npm run
build` ahí, no es parte del código de este ticket).

Pendiente / fuera de alcance: **DoD de prueba manual sin correr todavía** (un viaje
con matches y uno sin matches, el aviso de AC6 apareciendo en otra pantalla, el
deep-link de AC7 con un payload mockeado) — mismo estado que quedó documentado en
MOVO-148/166 ("no probado en device"), pendiente de una pasada en simulador/dispositivo
contra `svc-shipments` real con datos sembrados a mano (sin script de seed en el
repo). AC7 no puede probarse de punta a punta hasta que `MOVO-179` exista. Cobertura
de `useTripMatches` baja en el reporte (el módulo se mockea entero en los tests de
pantalla) — mismo patrón ya aceptado para `useAvailableShipments`/`useMyShipments`,
ninguna de esas hooks tiene tampoco un test dedicado; evaluado con el usuario y
descartado sumar uno para no romper la convención existente por una cobertura
incidental.

