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

### MOVO-177 — Rediseño de creación de oferta del transportista: pantalla completa, desglose en tiempo real, fecha/horario alternativo (`movo-mobile`)

Implementación sobre un mockup de Claude Design ("Transportista - Envío y Oferta")
que resuelve los 3 puntos que dejó abiertos el ticket de planificación homónimo
(surgido de probar MOVO-149 en dispositivo).

- **`CreateOfferSheet` (bottom sheet) reemplazada por pantalla completa**
  (`app/(app)/transport/[id]/offer.tsx`, ruta hermana de `transport/[id].tsx` — mismo
  patrón de convivencia `[id].tsx` + `[id]/algo.tsx` que ya usa `shipments/[id]`):
  ofertar es una transacción de plata real entre dos partes, no una confirmación
  puntual como cancelar/rechazar. Monto ingresado con un numpad propio (no el teclado
  nativo), chips rápidos (Sugerido/−10%/+10%) y comparación visual contra el precio
  sugerido.
- **Desglose neto/comisión/bruto en tiempo real mientras se tipea**, importando
  `computeOfferGrossPrice`/`getCommissionConfig` directo de
  `@movo/shared/dist/config/commission` — la propuesta que evaluó el propio ticket de
  planificación (bruto = neto de una función pura, misma tasa que ya usa el backend)
  en vez de duplicar `MOVO_COMMISSION_RATE` a mano en mobile. El monto final que
  persiste sigue siendo el que devuelve la respuesta del servidor, este es solo un
  preview.
- **Línea de "Procesamiento del pago" mostrada como estimado, nunca restada de "Te
  queda"**: `MP_TRANSACTION_FEE_RATE` sigue sin confirmar y `movo-svc-payments` no
  tiene split real todavía — el transportista de hecho recibe el neto completo que
  tipeó, así que "Te queda" es exactamente ese número, con una nota aclarando que el
  estimado de MP es solo contexto.
- **Fecha/horario de retiro alternativo** (bloqueado hasta el cambio de backend del
  mismo ticket, ver `services/movo-svc-shipments/CLAUDE.md` MOVO-177): "Como lo pidió
  el emisor" (default) vs. "Proponer otro día u horario" — day chips (0 a +3 días) +
  4 franjas fijas (`08:00–12:00`/`12:00–15:00`/`15:00–19:00`/`19:00–22:00`), enviados
  como `offeredPickupTimeWindowStart/End` solo en el segundo modo.
- **Entrega estimada (día/franja) construida solo en el cliente, sin backend
  todavía**: sección completa e interactiva ("A qué hora entregás (estimado)"), pero
  los valores NO viajan en el body de `POST /shipments/:id/offers` — el schema del
  backend (`additionalProperties: false`) los rechazaría con 400 si se mandaran. El
  contrato propuesto para dejar de ser un preview local quedó documentado en
  **MOVO-180** (Urgent, mismo ciclo que MOVO-177).
- **`transport/[id].tsx` (detalle del envío, vista transportista)**: la card lima de
  "Costo aproximado" se reemplazó por la card oscura del mockup ("Te queda si ofertás
  el sugerido", mismo `computeOfferGrossPrice` que la pantalla de oferta) + `$/km`
  sobre la distancia real de la ruta. El CTA "Hacer una oferta" pasa de abrir un sheet
  a `router.push` a la pantalla nueva.
- **"Ofertas actuales" (conteo + mínimo) del mockup, omitida a propósito**: requiere
  un endpoint nuevo (`GET /shipments/:id/offers` hoy está restringido al emisor) —
  documentado en MOVO-180 en vez de inventar un número falso o exponer datos que el
  backend no entrega hoy.

Tests nuevos: `test/create-offer-screen.test.tsx` (preview en tiempo real, chips
rápidos, numpad, envío con fecha pedida, envío con fecha/franja alternativa —
bloqueado sin franja elegida, error de KYC, error genérico). `test/create-offer-sheet.test.tsx`
eliminado junto con el componente que reemplaza. Ajustes en
`test/transport-detail-screen.test.tsx` (navegación en vez de sheet). 639/639 tests
en verde, `tsc --noEmit` limpio.

**Ajuste post-feedback (mismo día): la card de precio sugerido no coincidía con el
mockup.** Tres bugs reales de la primera versión, no solo gusto estético:
- **`GridPattern` invisible**: el color fijo del componente (`#0A0A0B`, pensado para
  las OTRAS cards claras del repo) quedaba negro-sobre-negro en esta card, que
  siempre es oscura. `GridPattern` ganó props opcionales `color`/`opacity`
  (default sin cambios, retrocompatible) — acá se usa con líneas blancas.
- **Bajo contraste de verdad, no solo percibido**: la card usaba `bg-fg`/`text-fg-2`/
  `text-fg-3` (tokens semánticos que se INVIERTEN en dark mode — `bg-fg` es blanco en
  dark). Sobre una card que el mockup diseñó siempre oscura, eso significaba texto
  gris oscuro sobre negro (ilegible) y, en dark mode, la card entera se habría vuelto
  blanca. Reemplazado por la escala fija `ink`/`paper` (`bg-ink-950`, `text-ink-300`/
  `text-ink-400`, `text-paper`) — mismo criterio que ya usa `PrimaryButton
  variant="lime"` (`text-ink-950` fijo, nunca invertido) para un chrome que se ve
  igual sin importar el tema.
- **Subcards de "Ofertas actuales" y "$ por km" faltantes**: la primera versión las
  había omitido a propósito por falta de dato real (`GET /shipments/:id/offers` está
  restringido al emisor) — resuelto adelantando esa parte de MOVO-180 (ver
  `services/movo-svc-shipments/CLAUDE.md`, entrada de MOVO-177): `ShipmentSummary`
  mobile suma `offersSummary?: { count, minPriceNetArs } | null`, consumido acá con
  fallback explícito ("Sin ofertas todavía") en vez de un número inventado cuando es
  `null`.
- Espaciado corregido: padding de la card `px-4 py-4` → `px-5 py-5`, tamaño del monto
  `36px` → `40px`, gaps entre secciones ajustados para que respiren más parecido al
  mockup.

Tests nuevos: 2 casos en `test/transport-detail-screen.test.tsx` (conteo/mínimo real
vs. estado vacío). 641/641 tests en verde.

**Segunda ronda de feedback (mismo día): la sección de retiro no se parecía en nada
al prototipo.** La versión original era una card suelta de `bg-bg-mute` con solo
fecha/hora de retiro — el mockup en cambio define una card "Recorrido" completa con
retiro Y entrega, iconografía de itinerario (cuadrado para el origen, círculo para el
destino, conectados por una línea punteada vertical) y un chip de horario por parada.
Reemplazada por esa card completa:
- **Cuadrado (`Retirás`) + línea punteada (`border-l border-dashed`, zero-width) +
  círculo (`Entregás`)**, mismo lenguaje visual que el riel de `TimelineSection`
  (MOVO-127) pero para un itinerario de 2 paradas fijas, no una línea de tiempo de N
  eventos.
- **Dirección + zona reales, no inventadas**: `shortAddressLabel`/
  `zoneLabelFromAddress` (ambas ya existentes en `shipment-format.ts`, MOVO-127/148)
  separan "Paul Dirac 7777" de "Argüello" a partir del único campo real
  (`pickupAddress`/`deliveryAddress`, string con comas) — el modelo no tiene un campo
  de piso/timbre separado, así que esa parte del mockup (**"4.º piso, tocar timbre
  B"**) no se replicó por no ser un dato real.
- **Chip de horario de retiro** con la fecha/franja real del envío (`pickupDateLabel`
  + `pickupTimeWindowStart/End`, ya existentes). **Chip de entrega** con el mismo
  copy honesto que ya usaba el paso de "Cuándo entregás" del wizard: "Sin horario
  fijo · lo definís vos en la oferta" — sigue siendo cierto hoy (no hay entrega
  estimada real, ver MOVO-180 sección 1).

Test nuevo: 1 caso en `test/transport-detail-screen.test.tsx` (retiro y entrega con
dirección/zona/horario). 642/642 tests en verde, `tsc --noEmit` limpio.

**Tercera ronda (mismo día): la card estaba apretada y el radio no coincidía con el
resto de la pantalla.** `rounded-md` (~6px) reemplazado por `rounded-[14px]` — mismo
radio que `RouteMapCard`/`PackageCard`/`CounterpartCard`, las otras cards de esta
misma pantalla. Padding de cada fila subido (`px-3.5`→`px-4`, `pb-3`/`pt-3.5`→
`pb-5`/`pt-5`) y el bloque de texto ganó `gap-1` propio en vez de que cada línea
pusiera su propio `mt-*` suelto — más aire entre eyebrow/dirección/zona/chip.

**Cuarta ronda (mismo día): la línea punteada tenía que terminar en una flecha
tocando el círculo de "Entregás".** Requería más que agregar un ícono — con dos
`<View>` de fila separadas (una por parada), la línea vivía dentro de la fila de
"Retirás" y se cortaba en el padding entre ambas filas, lejos del círculo de la
fila de abajo. Se colapsó a **una sola fila** con una única columna de itinerario
compartida (cuadrado → línea punteada `flex-1` → `ChevronDown` → círculo, los 4
hijos de la misma columna flex) y una columna de texto con los dos bloques
apilados (`gap-5`) al lado — al ser la columna de ítems un solo `flex` estirado
por toda la fila, la flecha queda pegada al círculo sin importar cuánto mida el
bloque de texto de "Retirás" (chip con foto adicional, mensaje más largo, etc.).

**Quinta ronda (mismo día): esa columna única se pasó de rosca** — al ser un solo
`flex-row` para las DOS paradas, la columna de ítems se estiraba (`alignItems:
stretch`) hasta el alto de TODO el bloque de texto (Retirás + gap + Entregás
completo, chip incluido), así que el punto de "Entregás" terminaba pegado al final
de la card entera, no a la altura de su propio título. Vuelta a **dos filas
independientes** (cada ícono estira solo con su propio bloque de texto, alineado
correctamente) — pero el espacio ENTRE ambas filas pasó a ser el `pb-5` del bloque
de texto de "Retirás" (padding, no un `gap` del contenedor): al sumar al alto
renderizado de esa fila, la columna de ícono de esa fila se estira esos mismos 20px
de más por el mismo `alignItems: stretch`, y la línea punteada (`flex-1`) los
rellena — termina exactamente donde arranca la fila de "Entregás", sin hueco y sin
desalinear nada.

**Sexta ronda (mismo día): "Con quién tratás" — unificar emisor y receptor en una
sola card.** Reemplaza las dos secciones separadas ("Emisor"/"Receptor", cada una su
propio `CounterpartCard` con borde propio) por una única card con dos filas
(`PartyRow`, nuevo, local a este archivo) separadas por un divisor de 1px, mismo
lenguaje que el mockup:
- **Nombre + rol inline** ("Pedro Yorlano · emisor") en vez del nombre solo con el
  rol como título de sección aparte.
- **Emisor**: si está verificado, `ProfileVerifiedBadge` (ya existente) ganó un prop
  `suffix` opcional para sumar la reputación ("Identidad verificada · 4,9 en 34
  envíos") sin duplicar el ícono/texto base en otro componente — antes ese dato no se
  mostraba en ningún lado de esta pantalla porque el comentario legado de
  `CounterpartCard` decía "reputationScore es siempre null" (cierto hasta MOVO-170/
  MOVO-147, que ya lo completan del lado de `svc-users`; el comentario había quedado
  desactualizado).
- **Receptor**: en vez del chip de color de `CounterpartCard`, texto plano bajo el
  nombre — un chip por fila iba a competir visualmente con el badge de identidad
  verificada de la fila del emisor en la misma card. Copy propio (`RECEIVER_
  CONFIRMATION_TEXT`, local) distinto al de `CounterpartCard` ("Ya aceptó recibir el
  paquete" en vez de "Aceptó el envío") — mismo criterio, pantalla distinta.
- `CounterpartCard` no se tocó ni se eliminó — sigue siendo lo que usa
  `shipments/[id].tsx` (vista emisor/receptor, MOVO-127/131), que si tiene layouts
  separados por sección tiene sentido para ese contexto.

Tests: 1 caso nuevo en `test/transport-detail-screen.test.tsx` (rol inline,
verificado+reputación, estado de confirmación del receptor) + ajuste del caso
existente que buscaba los eyebrows "Emisor"/"Receptor" (ya no existen). 643/643 tests
en verde, `tsc --noEmit` limpio.

### Fix de negocio (mismo día): el campo de monto de la oferta funcionaba al revés

El equipo aclaró que el campo "¿Cuánto pedís por el viaje?" siempre se pensó como el
**bruto** que se le cobra al emisor, no como el neto que se lleva el transportista
(al revés de como se había implementado en MOVO-149/MOVO-177 originalmente, AC6 de
MOVO-143). Esto además destapó un bug real: `shipment.suggestedPriceArs` YA es bruto
(el mismo precio sugerido que ve el emisor al crear el envío, MOVO-82/ADR-018) — la
pantalla de oferta lo prefillaba y lo trataba como si fuera neto, y la card "Te queda
si ofertás el sugerido" del detalle (`transport/[id].tsx`) le sumaba una SEGUNDA
comisión encima del bruto, mostrando un número inflado y falso.

- **`app/(app)/transport/[id]/offer.tsx` gana un toggle bruto/neto** (`amountMode`,
  default `"gross"`): "Quiero cobrar" (bruto, lo que el emisor paga) vs. "Quiero que
  me paguen" (neto, lo que le queda al transportista). El cálculo es bidireccional —
  en modo neto se reusa `computeOfferGrossPrice` (`@movo/shared`) tal cual antes; en
  modo bruto se resuelve la inversa acá mismo (`neto = bruto / (1 + tasa)`), porque
  `@movo/shared` solo expone el sentido neto→bruto. El backend
  (`POST /shipments/:id/offers`) sigue esperando siempre el NETO en
  `priceOfferedArs` — sin cambios de contrato, la conversión pasa a ser 100%
  responsabilidad del cliente antes de mandar la request.
- **Cambiar de modo convierte el monto tipeado, no lo resetea a cero** — al tocar el
  toggle, el monto se recalcula al equivalente exacto en el modo nuevo (usando los
  valores ya derivados del modo anterior), para que la transacción real no cambie
  solo por reencuadrar cómo se lee el número.
- **Comparación "vs. sugerido" corregida para comparar unidades iguales**: antes
  comparaba el neto tipeado contra el bruto sugerido (manzanas con naranjas). Ahora
  `suggestedGross`/`suggestedNet` se derivan una vez y se elige cuál usar según
  `amountMode`, así la comparación siempre es bruto-contra-bruto o neto-contra-neto.
- **`transport/[id].tsx` ("Te queda si ofertás el sugerido"), mismo fix**:
  `computeOfferGrossPrice(shipment.suggestedPriceArs)` reemplazado por la conversión
  correcta bruto→neto (`suggestedNetIfOffered`). El número que se ve ahí ahora es
  más bajo que el sugerido (como corresponde a la comisión de Movo), no un bruto
  inflado con doble comisión.

Tests: 2 casos nuevos en `test/create-offer-screen.test.tsx` (default bruto con
desglose correcto, toggle preserva el valor real de la transacción al convertir) +
ajuste de 2 casos existentes que asumían neto por default. 1 caso nuevo en
`test/transport-detail-screen.test.tsx` (bruto→neto en la card del detalle, no el
bruto crudo). 645/645 tests en verde, `tsc --noEmit` limpio.

**Ajuste post-feedback (mismo día): chips "Sugerido"/"−10%"/"+10%" repartidos en todo
el ancho.** `Chip` (local a este archivo, reusado también por los chips de día/franja
horaria) ganó un prop `fill` opcional (default `false`, sin cambios para esos otros
usos que varían en cantidad/largo de label) — con `fill`, el chip pasa de `flex-none`
(ajustado al contenido) a `flex-1` y centra el texto, así los tres chips de monto se
reparten el ancho completo de la fila en partes iguales.

**Ajuste post-feedback (mismo día): formulario partido en 2 pasos.** La pantalla
completa (monto + desglose + fecha de retiro + entrega estimada + mensaje) en un solo
scroll quedaba demasiado larga. Se partió en `formStep: 1 | 2` (estado local, no un
`phase` nuevo — sigue siendo la misma fase "form" de siempre):
- **Paso 1** ("Monto de tu oferta" + toggle bruto/neto + "Cómo se reparte"): botón
  inferior "Continuar" (`canContinueToPickup = netArs > 0`), reemplaza al submit real
  mientras `formStep === 1`.
- **Paso 2** ("Cuándo retirás" + "A qué hora entregás (estimado)" + "Lo que va a ver
  el emisor" + mensaje): el banner de error/KYC se movió acá (antes vivía arriba de
  todo el formulario) — solo puede aparecer tras un submit fallido, que solo puede
  pasar en este paso.
- **El back del header retrocede un paso antes de salir de la pantalla** (mismo
  criterio que el resto de la app: nunca dos "volver" con comportamiento distinto) —
  en paso 2 vuelve al paso 1; recién en paso 1 hace `router.back()` de verdad.
- **Indicador de progreso**: 2 segmentos fijos (no una barra continua — son
  exactamente 2 pasos, nunca una cantidad variable) + "Paso N de 2" en el header.
- El `ScrollView` gana un `ref` y vuelve a scroll 0 en cada cambio de paso — sin esto,
  si el transportista había bajado bastante en el paso 1, el paso 2 arrancaría a
  mitad de camino mostrando contenido que nunca vio desde el principio.

Tests: 2 casos nuevos en `test/create-offer-screen.test.tsx` (navegación entre pasos,
"Continuar" deshabilitado sin monto) + ajuste de los 4 casos existentes que ejercitan
contenido del paso 2 (ahora primero avanzan tocando "Continuar"). 647/647 tests en
verde, `tsc --noEmit` limpio.

**Ajuste post-feedback (mismo día): más aire en el paso 1.** Con menos contenido por
pantalla (ahora un solo paso corto), los espaciados ajustados que tenían sentido en
la pantalla larga original se sentían apretados. Subidos: gap entre secciones del
`ScrollView` (`gap-6`→`gap-8`), padding del box de monto (`py-4`→`py-5`) y de las
filas de la card "Cómo se reparte" (`py-3`→`py-4`, `gap-2`→`gap-3`), y los márgenes
entre el toggle/caption/box/chips (`mb-3`/`mb-2.5`/`mt-2.5`→`mb-4`/`mt-3`/`mt-4`).

**Fix urgente (mismo día), revertido y corregido en la misma pasada**: se probó
reemplazar el teclado numérico dibujado a mano (`NumericKeypad`) por un `TextInput`
nativo (`keyboardType="number-pad"`), pero el usuario lo rechazó explícitamente
("quedó MUY mal... dejemos el teclado dibujado que quedaba bien") — el look del
teclado custom SÍ era el que se quería, el bug real era otro. Se volvió a
`NumericKeypad`/`KEYPAD_KEYS`/`padOpen`/el ícono `Delete` tal cual estaban, sin
tocar el diseño visual.

**El bug real (el único fix que sí quedó) era el prefill, no el teclado**: el
`useEffect` que completa el monto con `suggestedPriceArs` tenía `amount` en su array
de deps (`if (shipment && !amount) { setAmount(...) }`) — cada vez que el
transportista borraba el campo entero (con el numpad) para escribir un monto propio
desde cero, `amount` pasaba a `""`, el efecto se disparaba de nuevo, y lo volvía a
completar con el sugerido en el próximo render. Reemplazado por un `useRef`
(`didPrefillAmount`) que solo permite el prefill una vez, sin volver a dispararse
nunca más pase lo que pase con `amount` — este es el que se mantuvo, funciona igual
con el teclado dibujado que con cualquier otro input.

Tests: los del numpad original quedaron como estaban (`create-offer-amount-trigger`,
`create-offer-key-*`); el caso de regresión del bug de prefill se reescribió para
usarlo con el numpad (borrar los 4 dígitos de "4500" con `create-offer-key-del` y
verificar que no se auto-completa) en vez de `fireEvent.changeText`. 648/648 tests en
verde, `tsc --noEmit` limpio.

**Segundo fix urgente (mismo día): el toggle bruto/neto perdía centavos/pesos en
cada ida y vuelta.** `handleAmountModeChange` reescribía el monto tipeado con
`Math.round(...)` de la conversión al otro modo CADA VEZ que se tocaba el toggle —
ida y vuelta entre tabs (incluso sin escribir nada nuevo) iba redondeando en cadena,
así que "Te queda" en el botón "Continuar" cambiaba solo. Rediseñado con un
**ancla** (`anchor: { raw, mode }`, un solo `useState`) que separa "qué tipeó el
usuario y en qué modo" de "qué tab está mirando ahora mismo" (`amountMode`):
- **Cambiar de tab (`handleAmountModeChange`) ya NO toca el ancla** — solo cambia
  `amountMode`. Bruto y neto siempre se recalculan desde el mismo `anchor.raw`
  original (nunca desde una proyección redondeada anterior), así que ida y vuelta
  entre tabs sin editar nada es perfectamente estable, sin perder un centavo.
- **`displayedAmount`** (lo que se ve en el trigger/teclado) proyecta el ancla al tab
  activo cuando no coinciden — esa proyección SÍ es un entero redondeado (hace falta
  para poder seguir editándola con el numpad), pero es solo para mostrar: el "Te
  queda" real (`netArs`) sigue siendo el valor preciso derivado del ancla, no de esa
  proyección.
- **Editar (teclado o chips) después de mirar una proyección la "adopta" como nuevo
  ancla** en ese momento, recién ahí — no antes de que el usuario realmente toque
  algo.

**Bug extra encontrado escribiendo el test del numpad** (no reportado por el
usuario, pero real): los handlers de dígito/borrado leían `anchor` por closure en
vez de con la forma funcional de `setState` — una ráfaga de varios `fireEvent.press`
seguidos sin re-render de por medio (4 borrados + 3 dígitos en el test) perdía los
primeros toques, porque cada handler de la ráfaga leía el mismo `anchor` obsoleto
del render en que se creó. Los tres handlers (`editAmount`/`handleAmountDigit`/
`handleAmountDelete`/`scaleAmount`) pasaron a la forma funcional
(`setAnchor((prev) => ...)`), con `projectAmount` (función pura, sin estado) para
poder proyectar bruto↔neto desde DENTRO de ese callback sin depender de `netArs`/
`grossArs` del render actual.

Tests: 2 casos nuevos (ida y vuelta de tab sin editar no pierde precisión; editar
después de cambiar de tab adopta la proyección redondeada) + el caso del numpad
verifica de paso que la ráfaga de taps ya no pierde los primeros. 649/649 tests en
verde, `tsc --noEmit` limpio.

Pendiente / fuera de alcance: entrega estimada real (MOVO-180, sección 1 sigue
abierta); prueba en dispositivo físico del numpad/chips/card (no verificable en este
entorno).

### MOVO-183 — Rediseño del tab "Transportar": header, accesos, filtros y card

Implementación fiel al prototipo de Claude Design ("Transportista - Transportar")
sobre `app/(app)/(tabs)/transport.tsx` (MOVO-148/162/163) y
`components/transport/available-shipment-card.tsx`.

- **Header mínimo**: título + chip de zona (`transport-zone-chip`) que abre el mismo
  `AddressSearchSheet` que antes disparaba el link "Cambiar" (sin componente nuevo —
  ese sheet ya cubre GPS + guardadas + búsqueda, superset de lo que pedía el
  prototipo), compacto (ancho al contenido, `numberOfLines={1}`) en vez de ocupar una
  franja fija de la fila. Sin la línea "Envíos cerca de X" debajo — el prototipo no la
  tiene, y duplicaba lo que ya dice el chip (feedback de usuario tras la primera
  pasada).
- **Fila de resultados + orden** (`ResultsSortRow`, dentro de `transport.tsx`, sin
  archivo propio): entre el radio/filtros y la lista, "`N` envíos en `R` km" a la
  izquierda y un control de orden cíclico a la derecha (`transport-sort-cycle` —
  "Menos desvío" → "Mejor pago" → "Más próximo" → vuelta al primero), como en el
  prototipo (`cycleSort`/cycla `sortLabel`). Faltaba en la primera pasada del
  rediseño. "Menos desvío" ordena por `detourKm` de `computeOnTripDetour` (los sin
  match van al final); "Mejor pago" por `suggestedPriceArs` descendente; "Más
  próximo" por `pickupDate`+`pickupTimeWindowStart` ascendente (ambos ya vienen como
  string `YYYY-MM-DD`/`HH:MM`, comparables con `localeCompare`). Solo en el feed
  genérico — en modo `?tripId=` no se muestra, mismo criterio que el resto de los
  controles nuevos de esta US.
- **Dos accesos con contador** (`components/transport/transport-access-cards.tsx`):
  "Mis viajes" (activos/declarados, `useMyTrips`) y "Mis ofertas" (pendientes/
  aceptadas, `useMyOffers`, con punto lime cuando hay al menos una `accepted`) — el
  tab bar de abajo (`(tabs)/_layout.tsx`) no se tocó, sigue siendo el punto de
  navegación de Inicio/Transportar/Mi perfil únicamente.
- **Radio + botón de filtros con badge**: el resto de los controles (antes ausentes)
  viven en `components/transport/transport-filters-sheet.tsx` — tipo de paquete
  (multi), pago mínimo y peso máximo (single), y "Solo lo que me queda de paso"
  (`onlyOnTrip`, solo visible si hay al menos un viaje `active` declarado). Los 4
  son **100% client-side** sobre las páginas ya cargadas (`GET /shipments/available`/
  `GET /trips/:id/matches` no aceptan ninguno como parámetro) — mismo criterio ya
  aceptado en "Mis Envíos" (MOVO-113).
- **`computeOnTripDetour` nuevo** (`shipment-format.ts`): sin un endpoint que cruce
  el feed general de disponibles contra TODOS los viajes activos del transportista
  (a diferencia de `GET /trips/:id/matches`, que sí cruza pero contra UN viaje), la
  franja "Te queda de paso en Casa → Trabajo · +0,8 km de desvío" del prototipo se
  resuelve 100% client-side con datos que la pantalla ya tenía cargados (`useMyTrips`
  + el feed de disponibles). "Desvío" se define como km de MÁS por desviarse
  (`origen→retiro + retiro→destino − origen→destino`, siempre `>= 0`), no distancia
  perpendicular a la ruta — es la métrica que el copy le promete al usuario. Umbral
  fijo `ON_TRIP_MAX_DETOUR_KM = 2` (constante, no configurable por el usuario — en el
  prototipo era un control del propio editor de diseño, no un control de producto).
  Solo aplica en el feed genérico: en modo `?tripId=` ya está filtrado contra UN
  corredor, una segunda franja de desvío ahí sería redundante.
- **Card rediseñada** (`available-shipment-card.tsx`): ruta origen→destino apilada
  sobre un timeline vertical (antes horizontal con un separador), franja de desvío
  reemplazando la línea "~X km de viaje" cuando hay match on-trip, precio más
  prominente (`19px`, antes `14px`) con caption "precio sugerido" debajo. El badge
  "Te aceptaron" del prototipo **no se implementó**: un envío `accepted` deja de
  aparecer en `GET /shipments/available` en cuanto se asigna (dato de mock
  del prototipo, no un caso real de este feed) — mostrarlo habría sido un estado
  que nunca ocurre en producción.
- **"Mis ofertas" resumen nuevo** (`app/(app)/carrier/offers/index.tsx`): el propio
  prototipo describe esta pantalla como "el puente" hacia la pantalla completa
  (ranking/reparto/edición de precio, MOVO-151, todavía sin construir) — se
  implementó tal cual ese alcance, con datos 100% reales de `GET /offers/mine`
  (`useMyOffers`, ya existente desde MOVO-149): hero "En juego" (suma de `pending`)
  / "Confirmado" (suma de `accepted`) y una lista "Requieren algo tuyo" limitada a
  ofertas `accepted` (no hay ranking de posición real disponible acá — ese dato vive
  en `GET /shipments/:id/offers`, restringido al emisor — así que no se simuló "estás
  4to de 5" como hacía el mock). El botón "Abrir Mis ofertas completo" muestra un
  `Alert.alert` ("Muy pronto") en vez de navegar — decisión explícita del usuario
  para no adelantar MOVO-151 en este ticket.
- **Toggle "Activo/Pausado" de "Mis viajes", omitido del todo** (decisión explícita
  del usuario): hoy los viajes son de un solo uso (se declaran y se cancelan/
  completan, sin repetición) — un estado "pausado" no tiene nada que pausar todavía.
  Queda para cuando se declare la US de viajes recurrentes; `app/(app)/carrier/
  trips/index.tsx` (MOVO-162) no se tocó.

Tests: casos nuevos en `test/transport-screen.test.tsx` (accesos con contador,
navegación a `/carrier/offers`, chip de zona, filtro por tipo de paquete, merge de
detour on-trip, conteo de resultados y ciclo de orden), `test/shipment-format.test.ts`
(`computeOnTripDetour`), `test/my-offers-summary-screen.test.tsx` (nuevo).
`available-shipment-card.test.tsx` sin cambios — todos sus casos pasan tal cual contra
el layout nuevo. 102/102 suites, 784/784 tests en `movo-mobile`. `tsc --noEmit` limpio.

Pendiente / fuera de alcance: no probado en device; `ON_TRIP_MAX_DETOUR_KM` es una
aproximación geométrica sin validar contra el comportamiento real esperado por el
usuario en campo; MOVO-151 (pantalla completa de Mis ofertas) sigue sin construir.

### Fix post-release (MOVO-183): la franja "Te queda de paso" ignoraba la fecha del viaje

Bug reportado por el usuario probando en dispositivo: la franja de desvío del tab
Transportar aparecía sobre envíos de cualquier fecha, sin relación con el
`departureAt` del viaje declarado (ej. viaje el 9/9, franja mostrada sobre envíos del
19/9 y 30/9) — `computeOnTripDetour` (`shipment-format.ts`) nunca comparaba fechas,
solo geometría (`TripRoute` no tenía ni siquiera un campo de fecha). Contraste con la
otra mitad de MOVO-163 (alerta en foreground vía `GET /trips/:id/matches`): ese
endpoint sí exige mismo día calendario argentino entre `pickupDate` del envío y
`departureAt` del viaje (`toArgentinaCalendarDate`, ver
`services/movo-svc-shipments/CLAUDE.md`) — el gap era específico de esta
aproximación 100% client-side, que corre contra TODOS los viajes activos y no pasa
por ese endpoint.

- **`TripRoute` gana `departureAt: string`** y `computeOnTripDetour` exige también
  `pickupDate` del lado del envío — un viaje se descarta de la comparación si su
  `departureAt` no cae en el mismo día calendario argentino que el `pickupDate` del
  envío, antes de calcular ninguna geometría.
- **`toArgentinaCalendarDateString` de `@movo/shared`** (no una reimplementación
  local) resuelve la conversión — el mismo día que se escribió este fix se unificó
  con el cálculo equivalente que ya existía en el backend
  (`movo-svc-shipments/src/domain/pickup-window.ts#toArgentinaCalendarDate`), extraído
  a `shared/movo-shared/src/utils/argentina-date.ts` (ver su `CLAUDE.md`) para que
  las dos mitades de MOVO-163 (esta franja y `GET /trips/:id/matches`) compartan una
  sola implementación del offset de Argentina en vez de mantener dos a mano en
  sincronía. Import por subpath, mismo criterio que el resto del archivo
  (`@movo/shared/dist/utils/argentina-date`).

Tests nuevos en `test/shipment-format.test.ts` (`computeOnTripDetour`): fecha
distinta del envío descarta un viaje con geometría de paso; un `departureAt` de
madrugada UTC que cae la noche anterior en Argentina sigue matcheando el día
correcto. `tsc --noEmit` limpio.

### MOVO-223 — Rediseño de la ficha/selector de auto y su integración con declarar viaje

Implementación fiel a un prototipo interactivo de Claude Design ("Ficha de vehículo")
sobre el atomic-form de MOVO-172 (`app/(app)/vehicle-info.tsx`), que reemplaza la
carga 100% libre de marca/modelo/capacidad por un selector con catálogo argentino y
volumen estándar por modelo, más la integración con "Declarar viaje" (MOVO-162).

- **Catálogo estático en el mobile, decisión tomada con el usuario**: no existe
  ningún catálogo de referencia en ningún servicio del monorepo hoy, y el volumen de
  datos (10 marcas, ~50 modelos) es chico y cambia poco — no justifica una
  tabla/endpoint nuevo en `movo-svc-users` para un ticket de 2 puntos. **El backend
  no necesitó ningún cambio**: `VehicleProfile` (`brand`/`model`/`cargoCapacityLabel`/
  `licensePlate`, todos `string`) ya era compatible con lo que pide MOVO-223 — el
  mobile simplemente le manda ahora valores que salen del catálogo
  (`src/data/vehicle-catalog.ts`) en vez de texto libre del usuario.
  `cargoCapacityLabel` sigue siendo el único campo persistido para el volumen (no
  hay columna de tier); al recargar una ficha, `tierFromLabel`/`draftFromVehicle`
  reconstruyen el tier/segmento matcheando contra el catálogo, con fallback a un
  tier "?" para fichas viejas de MOVO-172 con texto libre que no matchea nada.
- **Pantalla rehecha como wizard de pasos** (`empty → brand → model/manual → plate →
  view/edit`), reemplazando el formulario atómico de 4 campos — sigue siendo el mismo
  archivo (`vehicle-info.tsx`), no una ruta nueva. `PlateInput`/`TierPicker`/
  `BrandAvatar` nuevos en `components/vehicle/`; `src/lib/plate-format.ts` (puro,
  testeado aparte) para detección/máscara/validación Mercosur vs. formato anterior.
- **"Eliminar vehículo" del mockup, omitido a propósito**: no existe ningún
  `DELETE /users/me/vehicle` en `movo-svc-users` (solo `GET`/`PUT` upsert de
  MOVO-172) — mismo criterio que el resto del repo de no exponer una acción que el
  backend siempre va a rechazar o que no tiene a dónde ir. Si se necesita en el
  futuro, es un ticket de backend aparte.
- **Logos de marca reales** (`src/lib/vehicle-brand-icons.ts`, `assets/car-brands/`):
  el mockup en sí usa un círculo con iniciales (`BrandAvatar`), no logos — el usuario
  aportó los PNG (con canal alfa real) para las 19 marcas del catálogo final. Metro no
  soporta `require()` con rutas dinámicas, así que cada logo tiene su propia línea
  explícita en el mapa — sumar una marca nueva implica agregar el archivo (slug en
  minúsculas sin tildes, guiones se conservan) y esa línea; sin entrada, `BrandAvatar`
  cae sola a las iniciales, nunca rompe.
- **Catálogo ampliado post-review del usuario** (`src/data/vehicle-catalog.ts`): de 10
  a 19 marcas y de 5 a 6 tiers (`XXXL` nuevo, para furgones grandes tipo Sprinter/
  Master/Ducato) — cubre además parque usado además de 0km (ACARA) y utilitarios de
  carga. Mismo *shape* de datos, sin tocar ningún tipo/helper. El único ajuste de
  código que forzó fue de UI: los badges de tier eran cuadrados de ancho fijo (`w-*`,
  pensados para ids de 2-3 caracteres) — con `XXXL` (4 caracteres) se cortaban.
  Cambiados a `min-w-*` + padding horizontal en los 5 lugares donde aparecen
  (`TierPicker`, badge de modelo, los dos badges de "Volumen de carga" de la ficha, el
  badge de la card de "Declarar viaje").
- **Esquinas cuadradas en cards con franja de color + bloque debajo** (bug de RN, no
  del diseño): un `View` con `overflow-hidden` + esquinas redondeadas no siempre
  recorta bien el fondo sólido de un hijo interno (más frecuente en Android) — la
  esquina del bloque de arriba/abajo se ve cuadrada en vez de seguir la curva del
  contenedor. Se corrigió redondeando cada bloque interno explícitamente (radio del
  contenedor menos el grosor del borde) en los 3 lugares con esa estructura: la card
  "Seleccionado automáticamente" de Declarar viaje, la card oscura "Vehículo
  verificado" de la ficha, y el recuadro de "Volumen de carga" (con su estado
  expandido/colapsado).
- **Integración con "Declarar viaje" (`components/trips/trip-form.tsx`, AC4)**: el
  `SelectField` fijo de `vehicleType` (`["Auto","Camioneta","Moto","Camión"]`,
  MOVO-162) se reemplazó por la ficha de vehículo real vía `useMyVehicle()` — con
  auto registrado, una card "Seleccionado automáticamente" (marca+modelo+patente+
  tier); sin auto, un cartel "Necesitás una ficha de vehículo" que navega directo a
  `/vehicle-info` (mismo criterio de "no prometer una salida que no existe" ya
  documentado en MOVO-162 AC4). `vehicleType` que viaja a
  `POST/PATCH /trips` pasa a ser `"${brand} ${model}"` derivado del vehículo, ya no
  texto elegido a mano — sigue siendo un `string` libre del lado del backend, sin
  cambios de contrato. `isValid` del formulario ahora exige también `!!vehicle`.
  `TripFormInitialValues` perdió el campo `vehicleType` (ya no aplica, con un solo
  auto por usuario el valor siempre sale de la ficha, nunca del viaje que se edita).
  La card de "Seleccionado automáticamente" suma el `BrandAvatar` (logo/iniciales de
  la marca) junto al badge de tier, a pedido del usuario — antes solo mostraba texto.
- **Selector de fecha/hora de salida de `DepartureDateTimePicker`, reescrito**: la
  primera versión de este ticket seguía el patrón ya existente en el repo
  (`TimeWindowPicker`) de `display="compact"` de iOS inline junto a un label propio —
  pero acá van dos campos lado a lado a mitad de fila, y el ancho mínimo intrínseco
  del widget nativo no se achica lo suficiente ahí (quedaba superpuesto/cortado con el
  ícono+texto, "no se ven bien"). Un segundo intento lo puso invisible
  (`opacity` chico) superpuesto sobre un pill propio — mejoraba lo visual, pero el
  área que ese control nativo reconoce como toque es su propio tamaño intrínseco
  (chico, centrado), no el `100%` del `style` absoluto que lo envolvía, así que solo
  una porción chica del pill abría el selector. La versión final abandona el widget
  compacto inline: el `Pressable` de todo el pill (mismo criterio que ya usa Android)
  abre una hoja inferior (mismo patrón `Modal`+`useSheetAnimation` que
  `select-field.tsx`) con un `DateTimePicker` `display="spinner"` real, visible y
  centrado adentro, más botón "Listo". Android no se tocó en ninguna vuelta (el
  diálogo imperativo ya usaba el pill entero como área de toque, sin este problema).
- **Texto explicativo agregado en "Declarar viaje"** (`new.tsx`, pedido del usuario):
  una línea debajo del header explicando para qué sirve declarar un viaje, mismo
  estilo que ya usa "Mis viajes" para su propia explicación.

Tests nuevos: `test/plate-format.test.ts` (detección de formato, máscara posición por
posición, validación completa), casos reescritos en `test/vehicle-info-screen.test.tsx`
(flujo completo por catálogo, búsqueda de marca, carga manual, errores de patente,
ficha ya registrada, edición), en `test/trip-form.test.tsx` (auto-selección desde la
ficha, cartel de registro sin vehículo) y en `test/departure-date-time-picker.test.tsx`
(reescrito para el flujo de hoja inferior en iOS). 104/104 suites, 806/806 tests en
`movo-mobile`. `tsc --noEmit` limpio.

Pendiente / fuera de alcance: no probado en device; `DELETE /users/me/vehicle` (si se
decide ofrecer "eliminar vehículo" de verdad) queda como ticket de backend aparte.

### MOVO-221 (mini-fix) — tab Transportar sigue el rediseño de estados de viaje

Lado mobile del rediseño `declared/active/completed` de `svc-shipments` (ver su
`CLAUDE.md`) — con el límite nuevo de 1 viaje `active` por cuenta, "N activos · M
declarados" en el acceso "Mis viajes" (`transport.tsx`, MOVO-183) dejó de aportar
nada (activos es siempre 0 o 1). `tripsMeta` pasa a mostrar solo la cuenta de
`declared` (los pendientes de iniciar). `computeOnTripDetour`/`showOnlyOnTripToggle`
(franja "de paso" y su toggle de filtro) se alimentan ahora de los viajes `declared`
en vez de `active`, por el mismo motivo — son los `declared` (que siguen siendo N)
los que describen "todos los trayectos que este transportista tiene pensados".
`src/lib/trip-format.ts` (`tripStatusLabel`/`tripStatusTone`, usado en "Mis viajes")
gana el caso `DECLARED` ("Declarado", tono `neutral`) — `ACTIVE` deja de compartir el
lima de "estado principal" con `declared`, ahora significa específicamente "en curso".

Sin botón "Iniciar viaje" todavía: `POST /trips/:id/start` (backend) no tiene ningún
punto de entrada en la UI — fuera de alcance de este mini-fix, que es 100% el ajuste
de `transport.tsx` que el ticket de backend dejaba pendiente.

Tests: 2 casos nuevos en `test/transport-screen.test.tsx` (un viaje `active` no cuenta
en `tripsMeta` ni aporta la franja de desvío — fijan explícitamente el cambio de
comportamiento) + `TRIP_A` (fixture compartida del archivo) pasó a `declared` por
default. `tsc --noEmit` limpio.

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

**Fusión posterior con mockup de referencia (mismo ticket, pedido explícito del
usuario): Actividad Reciente pasa de card a lista.** Se saca el `GradientBorderCard`
(chrome/sombra) de `recent-shipments-section.tsx` — queda un `View` plano con label +
línea divisoria fina (`h-px bg-border`) en vez de contenedor con borde/sombra. Se
mantienen los iconos propios (`ShipmentRow`: caja + flecha direccional superpuesta),
pero el estado pasa de pill (`ShipmentStatusBadge`) a texto plano alineado a la
derecha, como en el mockup. `ViewAllShipmentsLink` deja de ser una sección aparte
debajo (con su propio borde/fondo `bg-sub`) y pasa a ser el último ítem de la misma
lista, separado por el mismo `border-t` que el resto de las filas — confirmado
explícitamente con el usuario porque contradecía una decisión ya tomada 2 veces antes
("no competir con la card de Enviar"): con la card fuera, ya no hay chrome con el que
competir, así que la objeción original ya no aplicaba.

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

### MOVO-154 — Reputación visible: perfil propio, perfil público y tarjetas de oferta

Frontend de MOVO-25 sobre los campos que MOVO-152 (`svc-users`, ya Done) agregó a
`PublicProfile`: desglose por rol (`asSender`/`asCarrier`, cada uno con
`reputationScore`/`ratingCount`/`isNewProfile`) y `recentRatingComments`.
`PrivateProfile` (`GET /users/me`) sigue sin esos campos — solo el score/contadores
planos que ya tenía.

Alcance ampliado más allá de los 3 archivos que listaba el ticket: mientras se
armaba el plan surgió que **ninguna tarjeta de contraparte del detalle de envío era
tocable** — `CounterpartCard` (`shipments/[id].tsx`, `transport/[id].tsx`) era un
`View` sin `onPress`, escrita antes de que MOVO-152 diera reputación real. Se
extendió el ticket para que esas cards, y el bloque de calificaciones, abran el
mismo visor de perfil que ya usaba `offer-card.tsx`.

- **`CarrierProfileSheet` generalizado a `PublicProfileSheet`**
  (`components/shipments/carrier-profile-sheet.tsx` → `components/profile/
  public-profile-sheet.tsx`, prop `carrierId` → `userId`): ya era, de hecho, el único
  visor de perfil público de la app (avatar + badges + `ProfileStatsRow` en una
  bottom sheet), solo estaba atado al flujo de ofertas. Título del header pasa a
  **"Perfil" genérico siempre** (decisión explícita, sin condicional por rol) — se
  reusa desde 3 contextos (oferta de transportista, emisor, receptor de un envío).
- **`components/profile/reputation-detail.tsx` (nuevo)**: componente presentacional
  puro, sin fetch propio — desglose "Como emisor"/"Como transportista" (score + `n`
  de calificaciones vía `StarRatingInput readOnly` + `formatReputationScore`/
  `formatRatingCount` nuevos en `profile-format.ts`), línea explicativa fija del
  cálculo (AC8) y lista de hasta 10 `recentRatingComments` con `formatRatingDate`
  nuevo (`Intl.DateTimeFormat("es-AR", ...)`, mismo patrón que `shipment-format.ts`).
  Se renderiza siempre inline debajo de `ProfileStatsRow` — nunca detrás de una
  pantalla o sheet aparte, el AC8 solo pide que la explicación sea "accesible desde
  el perfil", no un flujo de navegación nuevo.
- **`formatReputationScore` gana un segundo parámetro opcional `isNewProfile`**
  (retrocompatible): con `true` devuelve `"Perfil nuevo"` sin importar el score,
  reemplazando el número en todos los lugares que lo pasan (`ProfileStatsRow`,
  `CounterpartCard`, `ReputationDetail`) — el umbral de 3 transacciones lo resuelve
  el backend, nunca se reimplementa acá (AC5).
- **`CounterpartCard` gana `onPress` opcional** (envuelve el contenido en
  `Pressable` con `ChevronRight` si viene, se comporta igual que antes si no) y
  muestra el score inline (`StarRatingInput readOnly` + texto) — el comentario
  viejo que decía "reputationScore siempre null hoy" ya no aplicaba desde MOVO-152.
  Los 4 render sites (`shipments/[id].tsx` ×2, `transport/[id].tsx` ×2) pasan
  `onPress` abriendo un único `PublicProfileSheet` por pantalla (mismo patrón de
  "una sheet, múltiples triggers" que ya usaba `RatingSheet` en esa misma pantalla).
- **`CounterpartyRatingRow`** (dentro de `shipment-ratings-card.tsx`) separa el tap
  de "ver perfil" (nuevo `onViewProfile`, sobre el bloque avatar+nombre) del botón
  "Calificar"/"Editar" — son acciones distintas, nunca comparten `Pressable`.
  `shipments/[id].tsx` conecta `onViewProfile` al mismo estado/sheet de arriba, sin
  instanciar una segunda sheet.
- **`offer-card.tsx` (AC7)**: el ícono de estrella estático + texto se reemplazó por
  `StarRatingInput readOnly` — mismo componente en modo lectura que pide el AC, no
  dos representaciones distintas del mismo dato. `OfferSummary.carrierRatingAtOffer`
  es un snapshot histórico sin flag de `isNewProfile` propio, así que la tarjeta de
  oferta no muestra "Perfil nuevo" — limitación aceptada, no bloquea el resto.
- **Perfil propio (`app/(app)/(tabs)/profile.tsx`)**: como `PrivateProfile` no trae
  desglose/comentarios, la pantalla suma `usePublicProfile(data.id)` en paralelo a
  `useMyProfile()` solo para alimentar `ReputationDetail` — verificado que
  `GET /users/:id` (`services/movo-svc-users/src/modules/users/users.routes.ts`) no
  distingue self-lookup de cualquier otro, así que no hizo falta tocar backend. Esa
  segunda query degrada sola (sin sección de reputación) si falla o sigue cargando,
  sin bloquear el resto del perfil.

Tests nuevos: `test/reputation-detail.test.tsx`. Casos agregados a
`test/counterpart-card.test.tsx` (tap abre sheet, score real/"Perfil nuevo"/"Sin
calificaciones"), `test/offer-card.test.tsx` (StarRatingInput en modo lectura),
`test/profile.test.tsx` (desglose por rol, degradación sin la segunda query),
`test/shipment-ratings-card.test.tsx` (`onViewProfile` separado de `onRate`),
`test/shipment-detail-screen.test.tsx` y `test/transport-detail-screen.test.tsx`
(tap en `CounterpartCard` abre la sheet). Fixtures de `PublicProfile` en
`test/offers-screen.test.tsx`/`shipment-detail-screen.test.tsx`/
`transport-detail-screen.test.tsx` actualizados con los campos nuevos de MOVO-152
(sin eso, `ReputationDetail` rompía al desestructurar `recentRatingComments`
`undefined`). 87/87 suites, 641/641 tests. `tsc --noEmit` limpio (aparte del ruido
preexistente y no relacionado de `available-shipment-card.tsx`, típed routes
gitignoreadas).

Pendiente / fuera de alcance: no probado en device; sin `title` contextual en
`PublicProfileSheet` (decisión explícita, "Perfil" genérico); DoD manual del ticket
(Sprint Review con datos reales de reputación) no verificable en este entorno.

### MOVO-176 — Rediseño de pantalla de perfil (prototipo Claude Design): sheet → pantalla completa

A partir de un prototipo armado con Claude Design ("Rediseño ficha de perfil
usuario"), reemplaza la bottom sheet chica de MOVO-154 (`PublicProfileSheet`,
borrada) por una pantalla completa (`app/(app)/profile/[id].tsx`) mucho más rica.
El prototipo traía datos que no existen en ningún lado del backend — se relevó con
el usuario qué construir y se abrieron 6 issues nuevas de Linear (MOVO-170 a
MOVO-175, sub-issues de MOVO-25) con el contrato propuesto para cada una. Esta US
deja **todo el frontend listo ya**, tipado contra esos contratos como campos
opcionales — cada sección nueva se oculta sola si el campo no llega en la
respuesta, así la pantalla no se rompe hoy y se completa sola a medida que cada
backend aterriza.

- **`PublicProfileSheet` → `app/(app)/profile/[id].tsx`**: los 3 puntos de entrada
  que abrían la sheet (`CounterpartCard` en `shipments/[id].tsx` y
  `transport/[id].tsx`, `offer-card.tsx` vía `offers.tsx`,
  `shipment-ratings-card.tsx`) pasan a `router.push('/profile/${userId}')`. El menú
  de reportar/bloquear se oculta en el perfil propio (`profile.id ===
  currentUserId`).
- **`components/profile/reputation-card.tsx` (nuevo)**: reemplaza el stacking
  siempre-visible de `ReputationDetail` (que sigue tal cual en el perfil PROPIO,
  `(tabs)/profile.tsx`) por un toggle "Como transportista"/"Como emisor" — oculto
  si la persona no tiene transacciones reales en ambos roles
  (`transactionCounts`, `PublicProfile` no expone `roles`, eso es privado). El rol
  activo se comparte con `usage-stats-grid.tsx` (ambos viven en la pantalla, no
  duplican el toggle). Barras de categoría (`breakdown.categories`, MOVO-173)
  solo se pintan si existen.
- **`components/profile/verification-chips.tsx` (nuevo)**: a propósito **no**
  desglosa identidad en "DNI"/"Selfie" por separado como sugiere el prototipo — el
  KYC es un único resultado pass/fail por tipo, mostrar sub-pasos aparentaría una
  precisión que el sistema no tiene. Teléfono/email solo aparecen si
  `PublicProfile.phoneVerified`/`emailVerified` existen (MOVO-170).
- **`components/profile/usage-stats-grid.tsx`, `vehicle-card.tsx`,
  `mutual-connections-row.tsx` (nuevos)**: cada uno oculta su sección entera si el
  campo correspondiente (`usageStats`/`vehicle`/conexiones mutuas) no viene —
  nunca rellenan con ceros ni ocultan a medias.
- **`components/profile/profile-actions-menu.tsx` (nuevo, MOVO-175)**: reusa el
  patrón exacto de `MenuView` de `sender-actions-bar.tsx` (MOVO-29) para
  "Reportar"/"Bloquear", modal de motivo con las 5 opciones de `ReportReason`
  (`@movo/shared`, nuevo) + detalle opcional, y `Alert.alert` nativo como último
  paso de la confirmación de bloqueo (mismo criterio que la baja de cuenta,
  MOVO-136). Las mutaciones (`use-moderation.ts`) pegan contra endpoints que
  todavía no existen (MOVO-175) — quedan listas, van a fallar hasta que esa issue
  aterrice.
- **`TextField` ganó soporte de `multiline`** (antes solo una línea) para la bio
  (MOVO-171) — sin componente nuevo, alcanzaba con no aplicar el centrado
  vertical de una sola línea cuando `multiline` está presente.
- **Bio y ficha de vehículo en `app/(app)/profile/edit.tsx`**: bio con el mismo
  patrón de guardado-al-`onBlur` que nombre/apellido (MOVO-171); fila navegable
  "Ficha de vehículo" (solo para `UserRole.CARRIER`) hacia `app/(app)/
  vehicle-info.tsx` (nuevo, MOVO-172) — formulario atómico con botón Guardar (a
  diferencia de `edit.tsx`, las 4 piezas del vehículo solo tienen sentido juntas).
- **Excluido a propósito: CTA "Mensajear a {nombre}"** del prototipo. Ya existe
  MOVO-26 en el backlog para chat, pero su propio AC dice que no funciona "sin una
  transacción activa en común" — el prototipo lo ofrecía desde cualquier perfil,
  contradiciendo ese alcance ya definido. No se agregó el botón.
- **`shared/movo-shared`**: todos los campos nuevos son opcionales/nullable con un
  comentario `// Pendiente: issue N` — ningún consumidor existente de
  `PublicProfile`/`PrivateProfile`/`ReputationBreakdown` se rompió.

Tests nuevos: `reputation-card`, `usage-stats-grid`, `vehicle-card`,
`verification-chips`, `mutual-connections-row`, `profile-actions-menu`,
`profile-detail-screen`, `vehicle-info-screen` (todos `.test.tsx`), más casos
agregados a `edit-profile-screen.test.tsx` (bio, fila de vehículo),
`offers-screen.test.tsx`/`shipment-detail-screen.test.tsx`/
`transport-detail-screen.test.tsx` (navegación a la pantalla nueva en vez de abrir
la sheet vieja). 95/95 suites, 681/681 tests. `tsc --noEmit` limpio (los 4 errores
de rutas tipadas nuevas eran caché de `.expo/types/router.d.ts`, gitignoreado —
se regeneran al levantar el dev server, verificado corriendo `expo start`
brevemente).

Pendiente / fuera de alcance: las 6 issues de backend (MOVO-170 a MOVO-175) en sí,
cada una en su propia rama; pantalla "Ver todas las calificaciones" paginada (el
link se omitió del todo en vez de dejarlo inerte, depende del endpoint paginado de
MOVO-170); no probado en device.

### MOVO-154 (rediseño post-feedback) — reputación y comentarios integrados a "Tu actividad" en el perfil propio

Feedback directo del usuario sobre la implementación original de MOVO-154 en el
perfil PROPIO (`app/(app)/(tabs)/profile.tsx`, distinto del perfil público de
MOVO-176): la sección quedaba "espantosa", sin integrar a la interfaz, con los
comentarios como una lista apilada con separadores que "va a crecer infinitamente"
a medida que lleguen calificaciones. Iterado primero como mockups en un canvas de
Claude Design (2 estados + la pantalla de destino) para validar el layout antes de
tocar código.

- **`ProfileStatsRow` + `ReputationDetail` (MOVO-154 original) borrados y
  reemplazados por `components/profile/profile-activity-card.tsx`**: una sola
  `GradientBorderCard` — antes eran dos cards "chrome" apiladas y visualmente
  desconectadas. Adentro: las 3 mini-cards de "Tu actividad" sin cambios, un
  divisor, y la reputación (toggle de rol si `transactionCounts.asSender>0` y
  `asCarrier>0` — mismo criterio que `ReputationCard` de MOVO-176, no el
  desglose siempre-visible de las 2 filas que tenía la versión vieja) + score
  grande y estrellas. Ninguno de los dos componentes viejos se usaba fuera de
  esta pantalla, así que el reemplazo no tocó ningún otro consumidor.
- **Comentarios: carrusel horizontal con peek (no una lista vertical)**: hasta
  10 `ReputationCommentCard` (nuevo, `components/profile/`, reusado también en
  la pantalla de destino) con el texto truncado a 3 líneas, más `dots` de
  paginación calculados en `onMomentumScrollEnd` (mismo patrón de índice por
  `contentOffset.x` que `PhotoViewerModal`, MOVO-127). El límite real contra
  "crece infinito" no es visual únicamente: `recentRatingComments` ya viene
  acotado a 10 desde el backend (MOVO-152) y el resto vive en una pantalla
  aparte, no en scroll infinito del perfil.
- **`app/(app)/profile/ratings.tsx` (nuevo)**: destino de "Ver todas" — link
  lime chico con chevron, mismo lenguaje que el resto de la app, sin el botón
  ancho "Ver todas las calificaciones (N)" que probó primero el mockup (el
  usuario pidió sacarlo por redundante: dos CTAs para la misma acción en la
  misma card). Reusa `usePublicProfile(myId)` con la MISMA query key que ya
  pobló `profile.tsx` — TanStack Query dedupea, cero requests de más. Sin
  toggle de rol acá (a diferencia del mockup): `recentRatingComments` no viene
  separado por rol en `PublicProfile` (es una lista global), así que un filtro
  ahí sería un falso affordance sobre un dato que no existe.
- Esto deja parcialmente resuelto el pendiente de MOVO-176 ("pantalla 'Ver
  todas las calificaciones' paginada, se omitió del todo") — existe la
  pantalla, pero sigue mostrando como mucho los mismos 10 que ya trae
  `PublicProfile`, no pagina de verdad hasta que el backend lo haga
  (MOVO-170). **Sigue siendo solo del perfil propio** (`usePublicProfile(myId)`
  hardcodeado) — el `app/(app)/profile/[id]/reviews.tsx` genérico que pedía el
  alcance original de MOVO-176 (para el perfil de CUALQUIER usuario, no solo el
  propio) nunca se construyó, ni siquiera oculto: no hay backend paginado real
  (confirmado, `GET /internal/users/:id/ratings/recent` en `svc-shipments` solo
  acepta `limit`, sin `page`/`cursor`) ni ningún link roto en su lugar. Pendiente
  real cuando MOVO-170 exponga paginación de verdad.

Tests: `profile-activity-card.test.tsx`, `reputation-comment-card.test.tsx`,
`profile-ratings-screen.test.tsx` (nuevos), `reputation-detail.test.tsx`
borrado, casos actualizados en `profile.test.tsx` (testIDs nuevos
`profile-activity-card`/`profile-activity-card-reputation`, más un caso para
"Ver todas"). 97/97 suites, 697/697 tests. `tsc --noEmit` limpio.

Pendiente / fuera de alcance: no probado en device (el carrusel se valida por
`onMomentumScrollEnd` en test, no por gesto real); paginación real de
`ratings.tsx` depende de MOVO-170.

### MOVO-15 (rediseño post-feedback) — banner de licencia como progreso "Perfil verificado X/2"

Feedback directo del usuario sobre `ProfileLicenseStatusBanner` (perfil propio,
CARRIER): "no me gusta lo que tenemos", con una referencia visual concreta —
card neutra con título "Perfil verificado", fracción de progreso, barra de dos
segmentos, texto y un CTA primario lime + "Después" secundario.

- **Se sacó el ícono y el tono warning/danger/neutral por estado**
  (`kyc-status-ui.ts` ya no se usa acá) — los 5 estados no-aprobados
  (`NOT_STARTED`/`PENDING`/`MANUAL_REVIEW`/`REJECTED`/`EXPIRED`) comparten
  ahora la misma card neutra (`border-border`/`bg-bg-sub`), solo cambia el
  texto y la label del CTA. `kyc-status-ui.ts` lo siguen usando el banner de
  identidad de `home.tsx`, `kyc.tsx` y el badge de perfil — no se tocó nada de
  eso.
- **Progreso fijo `1/2`**: cuando este banner se muestra, la identidad ya está
  aprobada por construcción (`roles` solo gana `CARRIER` al cerrar el
  onboarding en `profile-photo.tsx`, que exige KYC de identidad `approved`) —
  no hay ningún caso real de `0/2` que contemplar, así que no hace falta leer
  `kycStatus` acá, solo `licenseKycStatus`.
- **"Después" oculta la card con estado local (`useState`), sin persistencia**
  — decisión explícita del usuario: es un recordatorio de baja fricción, no un
  dismiss permanente. Vuelve a aparecer al reentrar a la pantalla de Perfil.

Tests: `profile-license-status-banner.test.tsx` (nuevo). 98/98 suites,
703/703 tests. `tsc --noEmit` limpio.

Pendiente / fuera de alcance: no probado en device.

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

### MOVO-193 (fase 1) — Home operativo: envíos activos por rol y "Requiere tu atención"

Frontend de `MOVO-191`, implementado contra un mock de `MOVO-192` (backend Todo, se
dejó comentario con el contrato propuesto en Linear). `home.tsx` suma, sobre un
prototipo de Claude Design: `RoleSection`/`ActiveShipmentCard` ("Estoy enviando"/"Voy
a recibir", `use-active-shipments.ts` + `ActiveShipmentSummary` en
`shipments-client.ts`) y `AttentionSection` ("Requiere tu atención",
`use-attention-tasks.ts`, derivado 100% de `GET /shipments/mine` sin fabricar datos).

- **Sin estado "llegando"/ETA de proximidad** (el prototipo lo tenía) — requiere
  tracking en vivo (MOVO-203/MOVO-11), fuera del contrato de MOVO-192.
- **"Estoy transportando" queda para una fase 2** de esta misma US: layout distinto
  (card de viaje agregado, no una card por envío — ver prototipo "Viaje del
  transportista"), depende de MOVO-206.
- **"Requiere tu atención" solo cubre dos casos reales** (receptor con envío
  `awaiting_receiver_confirmation`, emisor con `rejected_by_receiver`) — "ofertas
  nuevas" y "calificaciones pendientes" quedaron afuera por falta de backend
  (N+1 el primero, sin endpoint el segundo — se abrió `MOVO-222` para éste).
- Los CTA de la matriz del AC5 (`activeShipmentCta` en `active-shipment-format.ts`)
  muestran un aviso "Muy pronto" en vez de navegar: `MOVO-159`/`MOVO-160` (pantallas
  de handshake) siguen en Todo, mismo criterio que MOVO-183.

Tests nuevos: `active-shipment-format.test.ts`, `active-shipment-card.test.tsx`,
`role-section.test.tsx`, `attention-section.test.tsx`, `use-attention-tasks.test.ts`,
casos agregados a `home.test.tsx`. 108/108 suites, 813/813 tests. `tsc --noEmit`
limpio.

Pendiente / fuera de alcance: fase 2 (transportista); `MOVO-222`; no probado en
device; sin mock local en runtime para desarrollar contra la app corriendo de punta a
punta mientras `MOVO-192` no exista (solo mockeado en tests).

**Ajuste de fidelidad visual (mismo día, pedido explícito del usuario: "quiero que la
UI quede exactamente igual" al prototipo).** `active-shipment-card.tsx` rehecho como
réplica 1:1 de la estructura de la live card del `.dc.html` (antes era una versión
simplificada con los tokens genéricos del repo): encabezado con precio en
`font-mono-semibold` + contraparte, pill de estado, **stepper de 4 pasos fijos**
(Retiro/En camino/Llegando/Entrega, iconos `MapPin`/`Route`/`Package`/`Flag` de
`lucide-react-native`, ya usados en otras pantallas) y franja de retiro/entrega en dos
columnas.

- **Solo 2 skins, no las 4 del prototipo**: "chrome"/"titanio"/"lime"/"ink" eran una
  exploración de tonos del propio diseño, no estados de negocio — se usa "chrome" (el
  default del prototipo) para `assigned`/`in_transit` y "papel" (`proximo` en el
  prototipo) para `assigned_unfunded`. Colores fuera de la escala de tokens del repo
  (los del `skin()` del prototipo, ej. `rgba(10,10,11,0.14)`) quedan como constantes
  locales del componente (`CHROME`), documentado en el comentario del archivo.
- **El stepper nunca marca "Llegando" como paso actual** (`activeShipmentStepIndex`,
  `active-shipment-format.ts`): sin tracking en vivo (MOVO-203/MOVO-11) no hay señal
  de proximidad — `in_transit` avanza solo hasta "En camino".
- **`activeShipmentFooterText` nueva**: la frase de la fila inferior (junto al CTA
  cuando existe) se genera con datos reales (rol, nombre de la contraparte, estado),
  nunca un horario/ETA inventado.

Tests: casos nuevos en `active-shipment-format.test.ts`
(`activeShipmentFooterText`/`activeShipmentStepIndex`); `active-shipment-card.test.tsx`
sin cambios de aserciones (sigue verificando contraparte/estado/CTA/badges, ahora
sobre el layout nuevo). 108/108 suites, 817/817 tests. `tsc --noEmit` limpio.

**Segundo ajuste (mismo día, feedback del usuario): el precio como headline "no
sirve".** El primer intento de reemplazar el `#MOVO-4821` mockeado había usado el
precio acordado (`agreedPriceArs`) como headline mono — el usuario lo rechazó y
pidió volver a algo tipo código/ID. `activeShipmentDisplayCode` (nueva,
`active-shipment-format.ts`) deriva un `#MOVO-XXXXX` determinístico de los últimos 5
caracteres alfanuméricos del `id` real del envío (UUID) — visualmente igual al mock,
sin inventar un correlativo que el backend no persiste ni mostrar precio en el lugar
del código. Solo para mostrar: nunca se usa para identificar el envío contra el
backend, eso sigue siendo `shipment.id` completo.

Tests: `activeShipmentDisplayCode` en `active-shipment-format.test.ts`
(determinístico, dos ids distintos dan códigos distintos). 108/108 suites, 820/820
tests. `tsc --noEmit` limpio.

**Galería de dev del home operativo (mismo día, pedido del usuario)**: sin MOVO-192
(backend) es imposible llegar a la mayoría de estos estados a mano. `app/
dev-home-operativo.tsx` → `components/dev/HomeOperativoGalleryScreen.tsx` (mismo
patrón que `/dev-tokens`/`/dev-connection`, sin link desde la app — se navega
escribiendo la URL en el dev client), fixtures en `src/dev/home-operativo-fixtures.ts`.

- **Reusa los componentes reales** (`RoleSection`, `HomeSendCta`,
  `AttentionTaskList`), no los reimplementa — cero riesgo de que la galería se
  desincronice del home real.
- **`AttentionSection` se partió en dos** (`AttentionTaskList`, presentacional puro +
  `AttentionSection`, wrapper que llama a `useAttentionTasks()`): la galería necesitaba
  pasarle tareas fixture sin pasar por el hook real (que pega contra
  `GET /shipments/mine`).
- **Un fixture por cada combinación relevante del AC5** (assigned_unfunded/assigned/
  in_transit × "Hoy"/"Ventana vencida"), no un solo ejemplo feliz — toggle "Con
  datos"/"Sin envíos activos" para ver también el caso vacío (AC2/AC9).
- **`RecentShipmentsSection`/`ViewAllShipmentsLink` (MOVO-83/113) no se replican**: son
  hook-driven sin forma de inyectarles fixtures y no son parte de lo que construyó
  esta US — nota explícita en la pantalla en vez de fingir datos o dejar un error de
  red silencioso.

Tests: `home-operativo-gallery-screen.test.tsx` (con datos, sin datos, CTA visible) —
primer test de un screen de `components/dev/` en el repo (los otros dos no tenían).
109/109 suites, 823/823 tests. `tsc --noEmit` limpio.

**Fixes de fidelidad visual encontrados con la galería (mismo día, feedback del
usuario mirando `/dev-home-operativo` en device):**

- **Código del encabezado no era numérico**: `activeShipmentDisplayCode` sacaba los
  últimos 5 caracteres alfanuméricos del `id` (podían salir letras, ej. `#MOVO-EDHOY`
  con un fixture sin dígitos) — el mock siempre usa `#MOVO-4821` numérico. Ahora saca
  solo dígitos (`id.replace(/\D/g, "")`) y rellena con ceros a la izquierda si el
  `id` no tiene 5. Los fixtures de la galería (`home-operativo-fixtures.ts`)
  ganaron un sufijo numérico en el `id` — sin dígitos, todos mostraban el mismo
  `#MOVO-00000`.
- **La card metálica (`assigned`/`in_transit`) no se veía elevada**: la sombra estaba
  declarada pero `GradientBorderCard` no tenía ningún `backgroundColor` propio (solo
  el gradiente) — en iOS, una vista sin fondo opaco no calcula sombra. Se agregó
  `backgroundColor` explícito (cubierto por el gradiente, invisible) al mismo style
  que ya traía la sombra.
- **La línea del stepper se superponía a los íconos**: la barra conectora vivía
  DENTRO de la columna del paso siguiente con un offset negativo (`left:-50%`, truco
  de CSS del mock) — en React Native el orden de pintado entre hermanos es por
  posición en el árbol, no por capas de "elementos posicionados" como en CSS, así que
  la barra de la columna N+1 pintaba ENCIMA del nodo de la columna N en vez de quedar
  detrás. Reestructurado para que nodo y barra sean hermanos directos en flujo normal
  (`Fragment` alternando `<bar flex:1>`/`<nodo ancho fijo>`), sin overlap posible
  estructuralmente, sin importar orden de pintado.
- **Retiro/Entrega no se veían alineados**: la fila usaba `items-end` (alinear por
  abajo) — como "Entrega" tiene una línea menos que "Retiro" (sin dato de horario de
  entrega en el contrato de MOVO-192, que solo trae ventana de retiro), alinear por
  abajo dejaba el domicilio de "Entrega" pegado contra la fila de horario de
  "Retiro" en vez de contra su propio eyebrow. Cambiado a `items-start`.

Tests: sin cambios de aserciones (los tests ya verificaban contenido, no posición
exacta) — `active-shipment-format.test.ts` sigue cubriendo `activeShipmentDisplayCode`
con el mismo caso (el UUID de ejemplo ya solo tenía dígitos coincidentes en el
sufijo). 109/109 suites, 823/823 tests. `tsc --noEmit` limpio.

**Rediseño de "Requiere tu atención" (mismo día, feedback del usuario mirando la
sección real): sin ícono/formato de card y sin acción inline.** `AttentionTaskList`
(`attention-section.tsx`) suma ícono en círculo por tipo de tarea (`Inbox`/`XCircle`
de lucide, mismo lenguaje que `HomeSendCta`) y separa `onPress` (navega al detalle,
toda la card salvo los botones) de la acción de cada botón — la tarea de
confirmación (`awaiting_receiver_confirmation`) gana botones reales
"Rechazar"/"Aceptar" que resuelven la acción sin salir de Inicio. El título usa el
nombre real del emisor (`usePublicProfiles(senderId)`, "Julia te quiere enviar un
paquete") en vez del genérico "Tenés un envío para confirmar" (fallback mientras el
perfil no cargó). `receiverConfirmationDeadlineShortLabel` nueva en
`shipment-format.ts` ("vence en N h") para el `meta` denso de la card. La tarea de
`rejected_by_receiver` sigue con un solo botón ("Ver envío"), sin cambios de
comportamiento.

**Segunda vuelta, mismo día (feedback explícito del usuario): "para el aceptar o
rechazar deberíamos usar el sheet específico que se diseñó para esa función, que se
usa desde la página de detalle"** — la primera versión resolvía la confirmación con
un `Alert.alert` genérico; se descartó por completo a favor de reusar el sheet real.

- **`ShipmentConfirmationSheets` nuevo** (`components/shipments/
  shipment-confirmation-sheets.tsx`), extraído 1:1 de `ReceiverActionsBar`
  (MOVO-131/154): los tres modales (confirmar aceptación, éxito a pantalla completa,
  motivos de rechazo) y sus animaciones, sin trigger propio — expone
  `openAccept`/`openReject` vía `ref` (`ShipmentConfirmationSheetsHandle`). Las
  mutaciones (`useAcceptShipment`/`useRejectShipment`) viajan como props en vez de
  llamarse adentro: el caller es dueño de un solo `isPending` para deshabilitar sus
  propios botones, y el error resuelto se reporta por `onError` en vez de que el
  componente pinte su propio banner (cada contexto decide dónde mostrarlo).
  `ReceiverActionsBar` quedó reducido a sus botones/deadline/`ErrorBanner` propios +
  un `ref` a este componente — mismo comportamiento exacto, mismos testIDs,
  `receiver-actions-bar.test.tsx` sigue pasando sin tocarse.
- **`AttentionConfirmCard` nuevo** (`components/home/attention-confirm-card.tsx`):
  la card de la tarea de confirmación en Inicio, con sus propias instancias de
  `useAcceptShipment`/`useRejectShipment` y un `ShipmentConfirmationSheets` propio —
  tocar Rechazar/Aceptar abre el sheet real (mismo look que el detalle), tocar el
  resto de la card navega ahí. `AttentionTask` pasó a discriminated union
  (`AttentionInfoTask | AttentionConfirmTask`, `use-attention-tasks.ts`): la tarea de
  confirmación ya no lleva `onPrimary`/`onSecondary` (el hook dejó de resolver la
  mutación, eso es responsabilidad de la card), solo los datos crudos
  (`shipmentId`, `senderFirstName`, `title`, `meta`, `onPress`) que la card necesita.
- **Galería de dev** (`home-operativo-fixtures.ts`) actualizada al nuevo shape;
  necesitó mockear `useAcceptShipment`/`useRejectShipment` en su test porque
  `AttentionConfirmCard` ahora usa mutaciones reales de TanStack Query (la galería
  vive bajo el `_layout` real con `QueryClientProvider` en la app, pero no en el
  render aislado del test).

Tests actualizados: `use-attention-tasks.test.ts`, `attention-section.test.tsx`,
`home.test.tsx`, `home-operativo-gallery-screen.test.tsx`;
`receiver-actions-bar.test.tsx` sin cambios (verificado que sigue pasando tal cual
tras la extracción). 109/109 suites, 835/835 tests. `tsc --noEmit` limpio.

### MOVO-195 — Par de claves en el dispositivo: generación, SecureStore y firma del nonce (`movo-mobile`)

Primer código de criptografía asimétrica del lado mobile — cierra el hueco que
`MOVO-157` (`svc-users`, registro de clave pública) y `MOVO-158` (`svc-shipments`,
validación de firma/GPS) habían dejado sin cubrir: ninguno de los dos implementaba
quién genera el par de claves ni quién firma. Bloqueaba a `MOVO-159`/`MOVO-160`.

- **Sigue ADR-020 tal cual, no reabre el algoritmo**: el propio ticket dejaba el
  algoritmo "a definir, recomendado Ed25519" (AC3), pero eso ya estaba resuelto al
  implementarse `MOVO-158` — ECDSA P-256/SHA-256, clave pública en formato `raw` sin
  comprimir (65 bytes), firma IEEE P1363 (raw r‖s, 64 bytes). Usar Ed25519 habría
  hecho que el backend rechazara toda firma con 422.
- **`@noble/curves` (`@noble/curves/nist.js`, export `p256`)** en vez de
  `react-native-quick-crypto` o una clave no-exportable en Keychain/Keystore nativo
  (las tres opciones evaluadas con el usuario) — JS puro, sin módulo nativo, sin dev
  client/rebuild. `p256.sign(msg, priv)` con sus defaults (`prehash: true`,
  `format: "compact"`) ya hashea con SHA-256 y devuelve directo los 64 bytes r‖s —
  no hace falta hashear a mano ni reencodear nada para que calce con
  `webcrypto.subtle.verify` del backend. Verificado con un test que reproduce
  exactamente esa llamada (`test/signing.test.ts`, corre en Jest/Node vía
  `require("node:crypto").webcrypto`) — la forma más fuerte de probar compatibilidad
  byte a byte sin levantar `svc-shipments` real.
- **`src/crypto/keypair.ts`/`signing.ts`/`bytes.ts` (nuevos)**: `getOrCreateDeviceKeyPair()`
  mismo patrón "generar una vez, persistir en `expo-secure-store`, reusar" que
  `getOrCreateDeviceId()` (MOVO-107) — cubre AC5 (dispositivo nuevo) y AC6 (clave
  perdida por reinstalación) con el mismo camino, sin distinguir los dos casos: si no
  hay nada persistido, se genera. Los 32 bytes de la privada salen de
  `Crypto.getRandomBytesAsync` (`expo-crypto`, ya instalado) en vez de
  `p256.utils.randomSecretKey()` directo — mismo motivo que ya documentó MOVO-107
  para el `deviceId` (evita depender de que `globalThis.crypto.getRandomValues` esté
  poblado en Hermes). `bytes.ts` usa `atob`/`btoa` (ya usados en `src/lib/jwt.ts`) en
  vez de sumar un polyfill de `Buffer` — el repo no tenía ninguno instalado.
- **`SECURE_STORE_KEYS.handshakeDevicePrivateKey` sobrevive a `clearSession()`/logout**,
  mismo criterio que `pushDeviceId`: identifica al dispositivo, no a la sesión — si
  otra cuenta loguea en el mismo teléfono, reusa la misma clave física y registra su
  propia pública en su propio primer login.
- **AC5 respondido sin ticket de backend nuevo**: "verificar que el modelo de MOVO-157
  soporta múltiples claves por dispositivo/usuario" — no lo soporta, a propósito
  (`MOVO-157` ya excluyó explícitamente multi-dispositivo del alcance del TFG). Login
  en un dispositivo nuevo simplemente rota la clave pública vigente vía el mismo
  `POST /users/me/device-key` — el dispositivo viejo queda con una firma que el
  backend ya no puede validar, comportamiento esperado y ya aceptado en MOVO-157.
- **`src/hooks/use-device-key-bootstrap.ts` (nuevo)**, montado en `app/_layout.tsx`
  junto a `usePushNotifications()`: mismo patrón de guard con `useRef` (dispara una
  vez por transición a `sessionStatus === "authenticated"`, se resetea al
  des-autenticar). A diferencia del registro de push (best-effort silencioso para
  siempre), el AC7 exige que un fallo sea detectable — expone
  `status: "idle"|"pending"|"ready"|"error"` + `retry()`. El consumo real de ese
  estado para bloquear la entrada a la pantalla de handshake es de `MOVO-159`
  (fuera de este ticket); acá solo queda el primitivo listo.
- **`jest.config.js`**: `@noble/curves`/`@noble/hashes` se publican como ESM puro
  (`"type": "module"`, sin build CJS) — sumados a `transformIgnorePatterns` o Jest
  fallaba al hacer `require()` de sintaxis `import`/`export` sin transformar.

Tests: `test/keypair.test.ts` (genera y persiste si no hay nada, reusa lo persistido,
formato de la pública de 65 bytes, reintenta si el candidato random no es un escalar
válido), `test/signing.test.ts` (firma válida contra la verificación exacta del
backend, 64 bytes, protección contra replay entre payloads distintos, la privada
nunca aparece en el resultado), `test/use-device-key-bootstrap.test.ts` (dispara una
vez por login, vuelve a intentar tras logout/login, expone `"error"` sin crashear,
`retry()` recupera a `"ready"`, vuelve a `"idle"` al des-autenticar),
`test/device-key-secrecy.test.ts` (DoD explícito del ticket — la privada no es
recuperable desde `AsyncStorage` ni aparece en el estado de la app: como el repo no
tiene `@react-native-async-storage/async-storage` instalado en absoluto, la prueba
más fuerte posible es confirmar que el paquete ni siquiera es una dependencia
resoluble, más que `useDeviceKeyBootstrap()` solo expone `status`/`retry()` hacia
afuera y que `expo-secure-store` es la única vía de persistencia real). 107/107 suites
(807/807 tests) en `movo-mobile`, `tsc --noEmit` limpio.

Pendiente / fuera de alcance: pantallas de QR/escaneo (`MOVO-159`/`MOVO-160`, que van
a consumir `signHandshakeNonce()` y, si hace falta, gatear su entrada con el `status`
de `useDeviceKeyBootstrap`); prueba en dispositivo físico iOS y Android (Keychain vs.
Keystore real) y el ciclo completo generar→registrar→firmar→confirmar contra
`svc-shipments` real — no verificable en este entorno; rotación periódica de claves.

### MOVO-224 — Pantallas de Legal en Perfil: Términos y Condiciones y Política de Privacidad

Reemplaza el placeholder "Legal" de Perfil → Configuración
(`profile-settings-section.tsx`, MOVO-78) por un hub real
(`app/(app)/profile/legal/index.tsx`, mismo patrón hub→detalle que
`security.tsx`, MOVO-136) con dos pantallas de solo lectura: Términos y
Condiciones y Política de Privacidad, sobre el contenido redactado en
`docs/legal/` (borradores de trabajo, ver el aviso académico dentro de cada
documento).

- **Sin librería de markdown nueva**: `components/legal/markdown-lite.tsx` es
  un parser/render acotado a la sintaxis que realmente usan esos dos
  documentos (encabezados, párrafos, listas con guión/numeradas, blockquote,
  tablas, `---`) — no un markdown genérico. Las tablas del origen (2-4
  columnas) se re-interpretan como tarjetas apiladas "columna: valor" en vez
  de una tabla ancha con scroll horizontal, ilegible en un teléfono.
- **`src/content/legal/*.ts` es una copia** del contenido de
  `docs/legal/politica-privacidad.md`/`terminos-y-condiciones.md`, empaquetada
  como `string` — Metro no soporta importar `.md` como texto sin un
  transformer custom, que no se justifica para contenido que cambia con poca
  frecuencia. **Generada por `npm run sync:legal` (`scripts/sync-legal-docs.ts`,
  raíz del repo), no a mano** — ver la entrada "Automatización de sync de
  documentos legales" más abajo (sin ticket propio, tooling agregado después
  de esta US para cerrar el pendiente de sync manual que quedaba documentado
  acá).
- El blockquote del "Aviso académico" (primer bloque de ambos documentos) se
  renderiza como un callout `warning` (mismo tono que el resto de la app usa
  para "esperando algo"/atención), no como texto plano — es la parte más
  importante de leer de todo el documento en esta etapa del proyecto.

Tests nuevos: `test/markdown-lite.test.tsx` (parser), `test/legal-hub-screen.test.tsx`,
`test/legal-document-screens.test.tsx`; caso agregado a
`test/profile-settings-section.test.tsx`. 117/117 suites, 899/899 tests.
`tsc --noEmit` limpio.

**Segunda pasada (mismo día, feedback de usuario): renderizado más rico + índice
funcional + enlaces reales.**

- **Bloque de metadata del encabezado (`**Versión**`/`**Última actualización**`/
  `**Vigencia**`) pasa a un bloque `"meta"` propio del parser**, detectado solo
  al principio del documento (para no confundirlo con una intro en negrita de
  un párrafo normal, patrón que sí se repite más abajo, ej. "**Estado
  actual**: ..."). Se renderiza como una tarjeta chica de filas
  etiqueta/valor, no como el párrafo pegoteado que salía antes (el markdown
  fuente no tiene línea en blanco entre esas 3 líneas, así que sin este caso
  especial cualquier renderer las junta en un solo párrafo — es el
  comportamiento correcto de CommonMark, no un bug del parser).
- **Índice funcional sin tocar la sintaxis del markdown fuente**: cada
  encabezado y cada ítem del índice (una lista numerada común, sin sintaxis de
  enlace) se pasan por la misma función `slugify()` — si coinciden, el ítem se
  vuelve tocable. Evita escribir anclas `#slug` a mano en el índice (que se
  desincronizarían solas si un título de sección cambia).
- **Soporte de enlaces `[texto](url)`** en `renderInline` — antes no existía,
  por eso "Ver también: [Política de Privacidad](...)" se veía como texto
  crudo con corchetes. La itálica (`*texto*`, usada solo para envolver esa
  misma línea completa) se resuelve ANTES del split genérico y de forma
  recursiva: si entrara como una alternativa más del regex de split, su
  patrón codicioso se comía el enlace anidado entero como texto plano antes
  de que el enlace pudiera matchear — ese era el bug real detrás de "el
  enlace no funciona".
- **`LegalDocumentScreen` pasa a dueño del `ScrollView` y de los offsets de
  cada encabezado** (`onHeadingLayout`, poblado por `MarkdownLite` en cada
  `View` de encabezado) — al tocar un ítem del índice, hace
  `scrollTo({ y: offset })`. También resuelve ahí las otras dos clases de
  enlace: `mailto:`/URL externa vía `Linking.openURL`, y referencia cruzada al
  otro documento (`./politica-privacidad.md`/`./terminos-y-condiciones.md`)
  vía `router.push` a la pantalla hermana — nunca un enlace muerto.
- `docs/legal/*.md` actualizados en el origen: los emails pasan de
  `` **`email`** `` a `[email](mailto:email)`, y el link de exclusión de
  Google Analytics pasa de código en línea a un link real — las copias en
  `src/content/legal/*.ts` se regeneraron desde ahí.

Tests nuevos: casos agregados a `markdown-lite.test.tsx` (bloque meta, enlaces,
itálica de línea completa sin tragarse el link anidado, índice tocable,
`onHeadingLayout`) y a `legal-document-screens.test.tsx` (navegación cruzada
entre documentos, `mailto:` real, smoke test del índice). 117/117 suites,
911/911 tests. `tsc --noEmit` limpio.

Pendiente / fuera de alcance: pantallas de `movo-institucional` (a hacer en base
a los mismos documentos, en una US aparte); checkbox de aceptación explícita en
el wizard de registro y su versionado (qué versión aceptó cada usuario y
cuándo) — el hub de Legal de esta US es de consulta libre, no un gate de
onboarding; el contenido en sí sigue siendo un borrador (ver
`[A COMPLETAR]` pendientes en `docs/legal/`, trackeados en MOVO-225/226/227);
no probado en device (el scroll a ancla depende del `ScrollView` real, que en
el entorno de test no expone `scrollTo` de forma mockeable — cubierto solo
como smoke test de que no rompe, la lógica de cálculo de offset/slug sí está
100% cubierta a nivel de `MarkdownLite`).

**Tercera pasada (mismo día, feedback de usuario: contraste en dark mode +
color de los enlaces):**

- **Callout del aviso académico**: el texto pasó de `text-warning-700` a
  `text-ink-950` (fijo, no theme-aware) — mismo criterio que `ErrorBanner`/
  `SuccessBanner` (texto oscuro fijo sobre fondo pastel `warning-100`/`-300`,
  que también es fijo en los dos temas). `warning-700` sobre `warning-100`
  tenía contraste real más débil que `ink-950`, y encima el bloque quedaba
  "flotando" con un tono que no calzaba con el resto de una pantalla oscura.
- **Enlaces de negro/blanco en vez de azul**: `text-info-700` (azul fijo)
  reemplazado por `text-fg` (theme-aware: negro en claro, blanco en oscuro) +
  `underline`, tanto para `[texto](url)` como para los ítems tocables del
  índice — pedido explícito del usuario, no le gustaba el azul de link
  "genérico de internet".
- Direcciones de contacto de ambos documentos unificadas a
  `privacy@mail.movosend.app` (antes `terminos-y-condiciones.md` tenía
  `legal@movosend.app`, un dominio distinto al que ya usaba
  `politica-privacidad.md`) — pedido explícito del usuario, "dejemos privacy@
  en todos lados".

Test actualizado: `legal-document-screens.test.tsx` (el caso de `mailto:` pasa
a esperar `privacy@mail.movosend.app`). 117/117 suites, 911/911 tests.
`tsc --noEmit` limpio.

### MOVO-228 — Checkbox obligatorio de aceptación legal en el registro + "firma electrónica" en Perfil → Legal

Cierra el pendiente documentado en la entrada de MOVO-224 de más arriba: el registro
solo tenía un texto informativo ("al continuar aceptás...") sin checkbox ni
versionado. Ahora el último paso del wizard exige un tilde explícito, y el hub de
Legal muestra cuándo (y qué versión de) cada documento aceptó la cuenta.

- **`register.tsx` (paso de revisión)**: el texto pasivo se reemplazó por un checkbox
  real (`register-accept-legal`, mismo patrón visual que el "reconocimiento explícito"
  de `delete-account.tsx`, MOVO-136, pero en tono lime en vez de danger — acá no es
  una acción destructiva). El botón "Crear cuenta" queda deshabilitado sin tildarlo.
  Los links de "Términos"/"Política de Privacidad" dejaron de apuntar a
  `https://movosend.app/tyc`/`.../privacy` (un sitio externo) y ahora navegan a las
  pantallas reales de la app.
- **`app/(auth)/legal-terms.tsx`/`legal-privacy.tsx` (nuevos)**: espejos de
  `app/(app)/profile/legal/terms.tsx`/`privacy.tsx` bajo `(auth)` — el checkbox del
  registro necesita poder abrir el documento completo ANTES de que exista una sesión,
  y las rutas de `(app)/profile/legal/` están bloqueadas por el guard de sesión de
  `(app)/_layout.tsx`. Mismo componente compartido (`LegalDocumentScreen`) y mismo
  contenido — dos rutas, no dos documentos.
- **`use-registration.tsx` gana `acceptedLegal`/`setAcceptedLegal`**: `submitRegistration`
  valida `acceptedLegal` como defensa en profundidad (el botón ya lo impide, pero la
  función es parte de la API pública del contexto) y manda `termsAccepted:true`/
  `termsVersion`/`privacyAccepted:true`/`privacyVersion` al backend, con la versión
  sacada de `LEGAL_DOCUMENT_VERSIONS` (`@movo/shared`) — **gotcha real encontrado
  escribiendo el test**: el primer intento no incluía `acceptedLegal` en el array de
  dependencias del `useCallback` de `submitRegistration`, así que la función seguía
  leyendo `false` por clausura vieja aunque el estado ya fuera `true`.
- **`LEGAL_DOCUMENT_VERSION_MISMATCH` mapeado** en `error-messages.ts` — pasa solo si
  el usuario tiene una versión desactualizada de la app instalada.
- **Perfil → Legal (`app/(app)/profile/legal/index.tsx`) suma la sección "Firma
  electrónica"**: lee `termsAcceptedAt`/`termsVersion`/`privacyAcceptedAt`/
  `privacyVersion` de `useMyProfile()` (dato real persistido por el backend, no
  calculado en el cliente). Una cuenta creada antes de este ticket muestra "Sin
  registro (cuenta creada antes de este control)" en vez de inventar una fecha.

Tests nuevos: `test/auth-legal-screens.test.tsx` (las dos pantallas espejo bajo
`(auth)`); casos agregados a `use-registration.test.tsx` (no registra sin el
checkbox, y los 3 tests de registro exitoso ahora tildan `acceptedLegal` primero) y a
`legal-hub-screen.test.tsx` (firma electrónica con datos reales y con cuenta sin
registro — mockea `use-profile`, la pantalla ahora depende de `useMyProfile()`).
Fixtures de `PrivateProfile` actualizados en `change-email/phone-screen`,
`edit-profile-screen`, `profile.test.tsx`, `verify-email-screen` (campo requerido
nuevo). 118/118 suites, 916/916 tests. `tsc --noEmit` limpio.

Pendiente / fuera de alcance: sin test de UI dedicado para `register.tsx` en sí (el
repo no tenía ningún precedente de testear esa pantalla completa — solo el hook
`use-registration.tsx` — armar esa infraestructura de mocks, sobre todo de
`react-native-maps`, quedó fuera de alcance de este ticket); no probado en device.

### MOVO-229 — Gate al abrir la app + sheet de lectura/aceptación por documento en Perfil → Legal

Extiende MOVO-228 (checkbox obligatorio en el registro) al caso de una cuenta ya
autenticada cuya versión aceptada de Términos y/o Privacidad quedó vieja, o que nunca
los aceptó explícitamente (registrada antes de MOVO-228). Implementado en dos
pasadas: una primera con `Alert.alert` + navegación a rutas propias, **reemplazada
por completo el mismo día** sobre un prototipo interactivo de Claude Design
("Rediseño página Legal con estados de firma", leído vía `DesignSync`) que pedía un
sheet custom en vez del `Alert` nativo y un hub más claro con badges de estado — la
entrada de abajo describe solo el estado final.

- **`src/lib/legal-acceptance.ts`**: estado de 3 vías por documento
  (`"up_to_date" | "pending" | "update_required"`, no un booleano — "nunca se
  aceptó nada" y "se aceptó una versión que ya quedó vieja" son casos con copy
  distinto, mismo criterio que `metaFor()`/`buildDocs()` del prototipo) +
  `legalAcceptanceMeta()` (badge/firma/CTA por estado) + `legalEntrySheetCopy()`
  (título/cuerpo del sheet de entrada, distingue "Antes de empezar" de "Actualizamos
  nuestros documentos legales" según si hay algún `pending` sin ningún
  `update_required` de por medio).
- **`use-legal-document-links.ts` (nuevo)**: extraído de la primera versión de
  `legal-document-screen.tsx` — ancla del índice + `mailto:`/externo + referencia
  cruzada al otro documento, con el "a dónde va la referencia cruzada" inyectado por
  el caller (`onCrossDocument`) en vez de hardcodeado, para poder reusarlo tanto en
  pantalla completa (navega) como en el sheet (cambia de documento sin salir).
- **`components/legal/legal-document-sheet.tsx` (nuevo)** reemplaza la navegación a
  `/profile/legal/terms`/`privacy` (rutas borradas): sheet inferior con el documento
  completo + botón de aceptar al pie (`useAcceptLegalDocuments`), fiel al prototipo
  (`showDocModal`). **"Ver también" cambia de documento SIN cerrar el sheet**
  (`kind` es estado local del sheet, no la ruta) — evita reabrir el problema que ya
  resuelven las pantallas de `(auth)` (una referencia cruzada al hub autenticado
  quedaría detrás del guard de sesión) y no rompe la sensación de "sigo leyendo un
  documento legal" con una transición de navegación completa en el medio. Al
  cambiar de documento se resetea scroll y anclas del índice.
- **`components/legal/legal-entry-sheet.tsx` (nuevo)** reemplaza el `Alert.alert` —
  mismo patrón `Modal`+`useSheetAnimation` que el resto de los sheets del repo
  (`ReceiverActionsBar`, MOVO-131). Sigue siendo **no bloqueante** (decisión ya
  confirmada): "Ahora no" solo cierra el sheet.
- **`use-legal-acceptance-entry.ts`** (antes `use-legal-acceptance-guard.ts`) pasa
  de disparar un efecto imperativo (`Alert.alert` + `useRef` de "ya se mostró") a
  exponer `{ visible, copy, onReview, onDismiss }` — `visible` es 100% derivado
  (`anyPending && !dismissed`, sin `useRef`), porque ahora es un elemento de UI
  persistente controlado por estado, no un disparo puntual. Montado en
  `app/_layout.tsx` vía `LegalAcceptanceEntryMount` — mismo gotcha ya documentado
  (depende de `useMyProfile()`/React Query, tiene que vivir DENTRO del árbol de
  `QueryClientProvider`, nunca en el cuerpo de `RootLayout`, que es quien lo define).
- **Perfil → Legal (`profile/legal/index.tsx`), rediseño completo**: de una lista
  con navegación a rutas propias pasa a dos tarjetas (ícono en círculo, badge "Al
  día"/"Pendiente"/"Nueva versión", la firma electrónica real como texto, y un
  botón que abre `LegalDocumentSheet` — nunca navega). El estado del sheet
  (`openDoc: LegalDocumentKind | null`) vive en el hub, no en el sheet, para poder
  controlar su animación de cierre igual que cualquier otro sheet del repo.
- **`profile-settings-section.tsx`**: la fila "Legal" suma un punto `warning-500`
  (`hasPendingLegalAcceptance`) — mismo lenguaje que el `anyPending` del prototipo
  en su lista de Ajustes. Es el reemplazo elegido para el "volver a mostrar el
  aviso" del prototipo (un link en su pantalla de Ajustes demo): en la app real ya
  existe un camino permanente a Legal desde Perfil, así que un link para "reabrir"
  el sheet de entrada específicamente no suma nada — se descartó a propósito.

Tests: `test/legal-acceptance.test.ts` (estado de 3 vías + meta + copy del sheet de
entrada), `test/use-legal-document-links.ts` cubierto indirectamente vía
`test/legal-document-sheet.test.tsx` (aceptar con la versión correcta, error de la
mutación, "Ver también" cambia de documento sin navegar, cerrar), `test/legal-entry-
sheet.test.tsx` (componente puro), `test/use-legal-acceptance-entry.test.ts` (estado
derivado, sin sesión, sin perfil todavía) — **`onDismiss`/`onReview` viven cada uno
en su propio archivo** (`-dismiss.test.ts`/`-review.test.ts`): un
`act(async () => ...)` que dispara `setState` deja el entorno de act roto para
CUALQUIER test que corra después en el mismo módulo, sin importar cuál acción se
llame ni el orden — reproducido y no resuelto con `waitFor`/reordenar, aislarlos en
su propio archivo fue lo que efectivamente lo resolvió. Casos actualizados en
`legal-hub-screen.test.tsx`/`profile-settings-section.test.tsx`. 123/123 suites,
935/935 tests. `tsc --noEmit` limpio.

Pendiente / fuera de alcance: sin historial de aceptaciones previas (backend, ver su
CLAUDE.md); no probado en device.

### MOVO-232 — Identificadores fijos de app store (`android.package` / `ios.bundleIdentifier`)

Primer paso para habilitar EAS Build/Submit y push notifications reales de punta a
punta, ahora que el Apple Developer Program ya está pago. `android.package` pasa del
placeholder de scaffold `com.anonymous.movomobile` al identificador real y fijo
`com.movosend.movomobile`; `ios.bundleIdentifier` pasa de variar por developer
(`com.movosend.movomobile.$USER`, pensado para no chocar provisioning profiles entre
Personal Teams gratis de Apple) a ese mismo identificador fijo, con `IOS_BUNDLE_ID`
como override opcional que sigue sirviendo para development builds 100% locales
(`expo run:ios`). `eas.json` fija `IOS_BUNDLE_ID=com.movosend.movomobile` en los
perfiles `preview`/`production` para que un build de EAS Cloud no dependa de `$USER`.
Verificado con `npx expo config --type public` (`bundleIdentifier`/`package`
resuelven al valor fijo).

**Avance post-merge de este ticket (mismo hilo de trabajo): credenciales de EAS y
`ENABLE_PUSH_NOTIFICATIONS`.** `PUSH_PROVIDER=expo` ya cargado en
`movo/dev/app-secrets` (AWS Secrets Manager) — el próximo deploy de `svc-users` a dev
manda push reales. Credenciales de EAS configuradas para ambas plataformas vía
`eas credentials` (iOS: App ID + certificado + provisioning profile + APNs Push Key,
autenticado con una App Store Connect API Key — Admin — en vez de Apple ID/contraseña,
respaldada en el secret `movo/mobile/apple-asc-api-key`, MOVO-232; Android: FCM V1).
`eas.json` gana `ENABLE_PUSH_NOTIFICATIONS: "true"` en el perfil `development`
(verificado con `npx expo config` que activa el plugin `expo-notifications`).

**Gotcha real encontrado en el camino, sin relación con el código del repo**: la
versión global de `eas-cli` estaba desactualizada (`21.8.0`) y esa versión tiene un
bug conocido (`iTunes service key is empty` al generar/validar la Push Key,
[expo/eas-cli#4392](https://github.com/expo/eas-cli/issues/4392)) — se resuelve
actualizando a `eas-cli@24.6.0`+ (fix confirmado en `24.4.1`). No es nada a ajustar en
este repo, documentado acá solo para que el próximo que corra `eas credentials` no
pierda tiempo si le vuelve a pasar.

**Segundo avance (mismo hilo): `google-services.json` para push real en Android.**
Gap encontrado en el camino, sin relación con lo hecho hasta acá: desde la migración
de Expo a FCM v1, Android necesita este archivo (identifica la app ante el proyecto
de Firebase "movosend", package `com.movosend.movomobile`) además del service account
ya cargado en `eas credentials` — sin él, Android no recibe push ni en build de EAS ni
local. `app.config.js` suma `android.googleServicesFile:
process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json"`. El archivo en sí
**no se trackea en git** (`.gitignore`, mismo criterio que los `.p8`/`.p12` de iOS) —
cada developer lo baja de Firebase Console y lo pega en la raíz de `movo-mobile/`
para builds locales; para EAS Cloud se subió como variable de entorno de tipo
**file** (`eas env:set development --name GOOGLE_SERVICES_JSON --type file
--visibility sensitive`, mismo mecanismo ya usado ahí para
`GOOGLE_MAPS_ANDROID_API_KEY`/`GOOGLE_MAPS_IOS_API_KEY` — no confundir con el bloque
`env` de `eas.json`, es un feature separado de EAS que se resuelve solo por
convención de nombre del build profile). Verificado con `npx expo config` y
`tsc --noEmit`.

Pendiente / fuera de alcance de este ticket (siguientes pasos del roadmap de
push/EAS): primer `eas build --profile development` (iOS y Android) + instalación en
dispositivo físico para validar push de punta a punta (cierra el DoD manual
pendiente de MOVO-107) — deliberadamente no disparado todavía. El workflow de CI para
build/submit automático ya existe (`.github/workflows/mobile-eas.yml`, ver la entrada
transversal en el `CLAUDE.md` raíz); el equipo venía generando los development builds
siempre con el CLI local (`expo run:ios`/`expo run:android`), nunca con EAS.

**Hook `eas-build-post-install` (`package.json`)**: EAS Cloud sube solo lo trackeado por
git y hace `npm install` en la raíz del monorepo, pero `@movo/shared` resuelve a
`dist/index.js` (gitignoreado) — sin este script, Metro no encuentra el paquete y el
build falla. EAS lo corre solo tras el install, con cwd en `movo-mobile/`; mismo motivo
por el que `pr-checks.yml` tiene su paso "Build @movo/shared" antes de los tests.

**Checklist: push notifications reales en development builds locales (`expo run:ios
--device` / `expo run:android`)**. Con `bundleIdentifier`/`package` fijos (MOVO-232)
y el Apple Developer Team pago ya operativo, un build local queda funcionalmente
igual a uno de EAS para push si cada dev/máquina/dispositivo tiene, una sola vez:

1. **Alta en el Apple Developer Team pago** (developer.apple.com → People, rol
   Developer alcanza) — sin esto Xcode no puede firmar contra ese team.
2. **Xcode → target → Signing & Capabilities**: elegir ese Team pago (nunca
   "Personal Team") + "Automatically manage signing". La capability de Push ya está
   habilitada a nivel de App ID (`com.movosend.movomobile`, se hizo una vez vía
   `eas credentials`) — Xcode la sincroniza sola al provisioning profile.
3. **`ENABLE_PUSH_NOTIFICATIONS=true` en el `.env.local` de cada dev** (gitignored,
   no confundir con `eas.json#build.development`, que solo aplica a builds de EAS
   Cloud). Sin esto, `app.config.js` saca el plugin `expo-notifications` y borra el
   entitlement `aps-environment` al hacer prebuild.
4. **Android: `google-services.json`** bajado de Firebase Console (proyecto
   "movosend") y pegado en la raíz de `movo-mobile/` (gitignored).

**No se repite en cada build** — es configuración persistente (archivo, cuenta,
provisioning profile). Se vuelve a hacer solo si: se borra/regenera `ios/` desde
cero (`rm -rf ios/`, `expo prebuild --clean` — ahí Xcode "olvida" el Team elegido),
se usa una máquina nueva, se prueba con un dispositivo físico nuevo (hay que
registrar su UDID en el Team), o se suma un dev nuevo al equipo.
### MOVO-160 — Escaneo de QR y confirmación con GPS (receptor de custodia)

Lado que **recibe** la custodia (transportista en el retiro, receptor en la entrega)
del handshake criptográfico (`MOVO-6`), contra el backend de `MOVO-158` (Done). El
scanner nunca firma nada — la firma que viaja en el QR ya la generó el cedente
(`MOVO-159`, todavía sin construir, con `signHandshakeNonce()` de `MOVO-195`); este
lado solo relee lo escaneado y agrega sus propias coordenadas GPS.

- **Entregado como componente + ruta standalone, sin cablear ningún CTA de
  producción** (decisión tomada con el usuario): hoy no existe ningún punto de
  entrada real — el CTA de Home para "Confirmar recepción" depende de `MOVO-192`
  (sin backend) y el de retiro depende de la fase 2 del home (`MOVO-206`, sin
  arrancar). `components/handshake/handshake-scan-step.tsx` (props
  `{shipmentId, onConfirmed}`, sin conocer wizard/orquestación) y
  `components/handshake/handshake-confirmation-result.tsx` quedan listos para que
  `MOVO-198`/`MOVO-199` los monten como un paso más cuando existan.
  `app/(app)/shipments/[id]/handshake-scan.tsx` es la ruta de prueba mientras tanto
  (navegación directa).
- **Formato del QR, definido acá por no estar en ningún ticket**: JSON
  `{shipmentId, nonce, signature}` — lo mínimo que necesita `POST
  /shipments/:id/handshake/confirm` (`{nonce, signature, lat, lng}` en el body, más
  el `shipmentId` de la URL). Documentado en un comentario de MOVO-159 (Linear) para
  que quien construya esa pantalla lo implemente igual del otro lado. `stage` no
  viaja en el QR — el backend ya lo resuelve del lado de `/confirm`.
- **`expo-camera` nuevo** (`CameraView`/`useCameraPermissions`, primer escaneo de
  códigos del repo) — plugin agregado a `app.config.js` con
  `barcodeScannerEnabled: true`, sin `cameraPermission` propio (el
  `NSCameraUsageDescription` ya existente desde MOVO-98 alcanza, solo se amplió el
  texto para mencionar el escaneo).
- **GPS reusa `getCurrentLocation()` tal cual** (`src/lib/location.ts`, mismo patrón
  que `use-my-location.ts`): si no hay permiso/no se puede obtener la posición, nunca
  se llama a `confirm` con un dato inventado (AC3) — se corta antes con un error
  explícito.
- **`HANDSHAKE_DISTANCE_EXCEEDED` es el único error "reintentable sin re-escanear"**
  (AC5): el componente guarda el último `{shipmentId, nonce, signature}` decodificado
  y el botón "Reintentar" solo vuelve a leer el GPS y reenvía la misma confirmación
  — el QR sigue vigente dentro de su TTL de 15s, no hace falta un código nuevo. El
  resto de los códigos (`HANDSHAKE_QR_EXPIRED`/`_INVALID_SIGNATURE`/
  `_CEDENTE_KEY_MISSING`/`_INVALID_SHIPMENT_STATE`, más un QR que no parsea como
  JSON válido) ofrece "Volver a escanear", sin guardar el payload.
- **Atajo de simulación de escaneo, solo `__DEV__`**: el DoD de dos-dispositivos-
  reales no es alcanzable todavía (`MOVO-159`, el generador del QR, también sigue en
  Todo) — un campo de texto para pegar el JSON a mano dispara el mismo camino que un
  escaneo real, mismo criterio que el propio prototipo de Claude Design ("Simular
  escaneo del receptor").
- **Pantalla de éxito propia, sin navegar a `/shipments/:id`**: esa pantalla
  (`MOVO-127`) solo sabe mostrar la perspectiva del emisor — le fallaría con 403 a un
  transportista/receptor hasta que `MOVO-194` (extensión de roles del detalle,
  todavía sin construir) exista. La ruta vuelve a Home en su lugar.

**Grooming de Linear hecho en el camino** (pedido explícito del usuario, al revisar
el árbol completo de dependencias de "fase 2 del home"): `MOVO-194` y `MOVO-199`
—ya con AC/DoD completos, solo sin dueño— sumadas al Cycle 6 y asignadas a Tomás.
`MOVO-207` se dejó con Pedro Yorlano a propósito (ya era suyo, no se reasignó).

Tests: `test/handshake-scan-step.test.tsx` (los 3 permisos de cámara, QR no-JSON/
incompleto, sin GPS, camino feliz, los 5 códigos de error con mensaje propio sin
cerrar la cámara, reintento de `DISTANCE_EXCEEDED` con el mismo nonce, "volver a
escanear" habilita un nuevo intento, atajo de simulación), `test/handshake-
confirmation-result.test.tsx` (copy por `stage`), caso nuevo en
`test/shipments-client.test.ts`. 115/115 suites, 881/881 tests. `tsc --noEmit`
limpio (sin `eslint.config.js` en `movo-mobile` todavía, ver pendientes del
paquete).

Pendiente / fuera de alcance: cablear un CTA real (`MOVO-198`/`MOVO-199`/`MOVO-193`
fase 2, todos sin arrancar); gating por rol en la ruta standalone (depende de
`MOVO-194`).

**`/dev-handshake` (mismo día, pedido del usuario): página de dev para probar esto
contra el backend real sin esperar a `MOVO-159`.** Mismo criterio que `/dev-tokens`/
`/dev-connection`/`/dev-home-operativo` — sin link desde la app, se navega
escribiendo la URL. Reusa `HandshakeScanStep`/`HandshakeConfirmationResult` tal cual
(cero fork).

- **Elegir un envío**: lista los envíos propios (`listMine`, emisor) tocables, o un
  campo para pegar cualquier ID — necesario para probar como transportista/receptor
  de un envío que no es propio (esos roles no tienen ningún endpoint de listado
  todavía, `MOVO-192` sigue Todo). Muestra el rol resuelto client-side y la etapa
  pendiente (retiro/entrega) como información, sin gatear ninguna sección — el
  backend es la única autoridad real de quién puede generar/confirmar.
- **`shipmentsClient.generateHandshake()` nuevo** (`POST /shipments/:id/handshake/
  generate`, MOVO-158, Done) — agregado ahora como parte del harness, pero es
  simplemente el wrapper HTTP: `MOVO-159` lo va a reusar tal cual para su pantalla
  real, no hace falta reescribirlo.
- **"Generar QR de prueba"**: pide GPS (mismo `getCurrentLocation()` que el paso de
  escaneo), llama a `generate`, firma el `canonicalPayload` con
  `signHandshakeNonce()` (MOVO-195, ya existente) y arma el JSON exacto
  `{shipmentId, nonce, signature}` que `HandshakeScanStep` espera — mostrado como
  texto seleccionable (mantener presionado para copiar, sin sumar `expo-clipboard`
  como dependencia nueva) para pegar en una segunda sesión/dispositivo logueado
  como la contraparte real, dentro del TTL de 15s.
- **Sin mock de ningún tipo**: todo pega contra `svc-shipments` real (`generate` y
  `confirm`) — el único camino no genuino es que, sin `MOVO-159`, generar y escanear
  hoy requiere dos pasadas manuales por esta misma pantalla (una por cuenta) en vez
  de dos pantallas de producción distintas.

Tests: `test/dev-handshake-screen.test.tsx` (selección de envío propio y por ID
pegado, rol/etapa resueltos, generar QR pide GPS y firma antes de llamar a
`generate`, sin GPS no llama a `generate`, confirmar desde el paso embebido llega a
la pantalla de éxito), caso nuevo en `test/shipments-client.test.ts` para
`generateHandshake`. 116/116 suites, 886/886 tests. `tsc --noEmit` limpio.

### MOVO-208 (backend, `svc-shipments`) — ajustes mobile por la extensión del set canónico

Ticket dueño en `services/movo-svc-shipments/CLAUDE.md` — acá solo el lado mobile,
tocado porque `ShipmentStatus` (importado de `@movo/shared`) pasó de 9 a 11 valores y
dos mapas exhaustivos ya existentes no compilaban sin las claves nuevas.

- **`src/lib/shipment-format.ts`**: `STATUS_LABEL` suma `ASSIGNED_UNFUNDED: "Fondos
  pendientes"` / `COMPLETED: "Completado"` (obligatorio, `Record<ShipmentStatus,
  string>` exhaustivo — no compilaba sin esto). `shipmentStatusTone` suma
  `ASSIGNED_UNFUNDED → "warning"` (mismo bucket que "espera algo antes de seguir") y
  `COMPLETED → "success"`. `shipmentLifecycleStage` suma `COMPLETED` a `"past"`.
  `HAPPY_PATH` suma `COMPLETED` al final de `DELIVERED` (relación 1:1 sin ambigüedad,
  `remainingLifecycleSteps`/`shipmentPendingStepLabel` ganan un caso para el paso
  "Liberación del pago"). **`ASSIGNED_UNFUNDED` no se agrega a `HAPPY_PATH`**: es una
  rama alternativa a `assignment_pending` (un envío pasa por una u otra, nunca las
  dos), y ese array modela un único camino lineal — insertarlo ahí habría roto la
  proyección de pasos de la rama existente. Un envío en `assigned_unfunded` queda sin
  pasos proyectados (mismo tratamiento que un estado de excepción), decisión de
  producto pendiente para cuando `MOVO-210` exista.
- **`components/shipments/timeline-section.tsx`**: `EVENT_ICON` (`Record<ShipmentStatus,
  LucideIcon>`, también exhaustivo) suma `CircleDollarSign` para `ASSIGNED_UNFUNDED` y
  `BadgeCheck` para `COMPLETED`.
- **`app/(app)/shipments/index.tsx`**: `STAGE_STATUSES` (array a mano, no exhaustivo —
  gap real encontrado explorando el código, sin ningún mecanismo que fuerce a tocarlo
  al extender el enum) suma `ASSIGNED_UNFUNDED` a `ongoing` y `COMPLETED` a `past`, para
  que ambos aparezcan como opción del filtro de estado de "Mis Envíos".
- **`canCancelShipment` deliberadamente sin tocar**: el backend
  (`shipments.service.ts#cancelShipment`) todavía no acepta cancelar desde
  `assigned_unfunded` (eso es `MOVO-210`) — agregar el botón acá mostraría una acción
  que el servidor rechazaría hoy.

Tests: casos nuevos en `test/shipment-format.test.ts` para `shipmentStatusLabel`/
`shipmentStatusTone`/`shipmentLifecycleStage`/`shipmentEventTitle`/
`shipmentPendingStepLabel`/`remainingLifecycleSteps` con los 2 estados nuevos. 103/103
suites, 796/796 tests. `tsc --noEmit` limpio.

### MOVO-197 — Step reusable de captura de evidencia fotográfica (retiro y entrega)

Frontend de `MOVO-21`, bloqueado por `MOVO-196` (backend, Done). Componente que van a
montar los dos wizards del transportista todavía sin arrancar (`MOVO-198` retiro,
`MOVO-199` entrega) — no orquesta navegación, solo expone si la evidencia mínima está
satisfecha.

- **`components/evidence/evidence-capture-step.tsx`** (props `{ shipmentId, stage:
  "pickup" | "delivery", onValidityChange? }`) + **`photo-thumbnail.tsx`** nuevos, en
  vez de generalizar `photos-step.tsx`/`photo-slot.tsx` (MOVO-83) — esos están
  acoplados al store Zustand del wizard de creación y a subida diferida al submit.
  Acá el `shipmentId` ya existe de entrada, así que **cada foto sube su propio ciclo
  completo apenas se toma** (`src/hooks/use-evidence-photos.ts`,
  capturar→comprimir→presign→PUT→confirm), no al final — permite progreso por foto
  (AC4) y que abandonar el wizard después de subir no pierda nada (`MOVO-198` AC5).
- **`ShipmentPhotoStage` ampliado de `"creation"` a `"creation" | "pickup" |
  "delivery"`** (`shipments-client.ts`, y el mismo ensanche en
  `PhotoUploadProvider`/`real-photo-upload-provider.ts`) — el backend ya soportaba
  los tres valores, solo el tipo del cliente estaba angostado a la carga del emisor.
- **`useEvidenceStatus(shipmentId)` nuevo en `use-shipments.ts`** (`GET
  /shipments/:id/evidence-status`, MOVO-196 AC6) — única fuente de mínimo/máximo/
  satisfecho, nunca hardcodeados en el cliente. Misma query key la puede consultar el
  wizard contenedor por su cuenta para gatear su propio paso siguiente sin duplicar
  la request (AC3 de MOVO-198/199, "consulta, no asume").
- **AC2 (denegación permanente de permiso de cámara) — patrón nuevo en el repo**:
  `takePhotoWithCamera` (`photo-utils.ts`) ganó `canAskAgain`/`unavailable` en su
  retorno (aditivo, no rompe a `photos-step.tsx`/`photo-picker.tsx`, que lo ignoran).
  El step distingue "denegado, reintentar en el momento" de "denegado para siempre,
  ir a Ajustes" — ninguno de los dos consumidores previos lo hacía.
- **AC3 (cámara no disponible) sin fallback a galería**: `launchCameraAsync` tirando
  (simulador/dispositivo sin cámara) se captura como `unavailable: true` — banner
  persistente, nunca se ofrece `pickPhotoFromGallery` como alternativa (a propósito,
  a diferencia de la foto de perfil).
- **AC7 recortado, confirmado explícitamente con el usuario**: no existe `DELETE` de
  fotos en `movo-svc-shipments` (confirmado contra el código de MOVO-196, no solo el
  ticket). "Eliminar antes de avanzar" aplica solo a fotos que **todavía no se
  confirmaron** (en cola, subiendo, en error) — una foto ya confirmada contra S3/DB
  queda fija, sin botón de borrado. No se abrió ticket de backend nuevo para esto.
- **Gap de diseño documentado, no un bug**: `GET /shipments/:id/photos` (MOVO-81) no
  incluye al transportista en su autorización (emisor/receptor/admin), así que el
  step no puede traer preview de fotos confirmadas en una sesión anterior al
  remontarse — solo trackea localmente lo capturado en el montaje actual.
  `evidence-status.photoCount` sigue siendo la fuente autoritativa del conteo total;
  la diferencia contra lo capturado en sesión se renderiza como celda "Confirmada"
  sin imagen, para que el grid cuadre con el máximo real sin mentir sobre qué hay.
- Traducciones nuevas en `error-messages.ts`: `PHOTO_STAGE_LIMIT_EXCEEDED`,
  `PHOTO_CONFIRMATION_IN_PROGRESS`, `PICKUP_EVIDENCE_MISSING`,
  `DELIVERY_EVIDENCE_MISSING` (los dos últimos los tira el handshake de MOVO-158/196,
  no los endpoints de fotos — el step nunca debería disparar esos dos si `evidence-
  status` gatea bien el paso siguiente, pero el mensaje ya está listo si igual pasa).

Tests nuevos: `use-evidence-photos.test.tsx` (los tres caminos de permiso, cámara no
disponible, fallo de red con retry sin perder fotos ya confirmadas, no-borrado de
confirmadas), `photo-thumbnail.test.tsx`, `evidence-capture-step.test.tsx` (mínimo/
máximo nunca hardcodeados, `onValidityChange` según `satisfied`, alert de permiso
correcto según `canAskAgain`), caso nuevo en `shipments-client.test.ts`. 126/126
suites, 953/953 tests. `tsc --noEmit` limpio (de paso, se detectó y corrigió que el
`dist/` local de `@movo/shared` estaba desactualizado — `RatingRole` existía en su
`src/` pero no en el build, rompiendo `tsc` de forma no relacionada a esta US).

Pendiente / fuera de alcance (igual que el propio ticket): orquestación de wizard
(`MOVO-198`/`MOVO-199`), validación de negocio de evidencia (ya la hizo `MOVO-196`),
ver fotos cargadas desde el detalle de envío (`MOVO-194`). No probado en dispositivo
físico ni los tres caminos de permiso reales — pendiente del DoD, no verificable en
este entorno (mismo criterio que MOVO-195/MOVO-107).

### MOVO-198 — Wizard de retiro del transportista: evidencia, escaneo de QR y confirmación

Contenedor con estado que encadena los pasos que hasta ahora vivían sueltos (o ni
existían): resumen del retiro → evidencia (`MOVO-197`) → escaneo del QR (`MOVO-160`)
→ confirmación. Primera vez que el transportista puede transicionar un envío
`assigned → in_transit` desde la app. Ruta nueva de 4 pasos bajo `app/(app)/
shipments/[id]/pickup/` (`_layout.tsx` + `index.tsx`/`evidence.tsx`/`scan.tsx`/
`success.tsx`), `src/hooks/use-pickup-wizard.ts` (gate) y
`src/hooks/use-pickup-proximity-check.ts` (AC4).

- **MOVO-160 (escaneo/confirmación) no se construyó de nuevo: se recuperó de un
  `git stash` abandonado** que tenía el trabajo completo como archivos *untracked*
  nunca commiteados (`components/handshake/handshake-scan-step.tsx`/
  `handshake-confirmation-result.tsx`, ruta standalone, harness `/dev-handshake`,
  3 suites de test) — el diff normal del stash solo mostraba 7 archivos de
  "plumbing" (cliente HTTP, `error-messages.ts`, `expo-camera`), el resto vivía en
  el tercer padre del commit de stash (el que usa `git stash -u` para lo
  untracked). Recuperado con `git stash branch` desde esa base exacta, rebaseado
  contra `develop` actual (PR #166) — sin ese hallazgo, este ticket hubiera
  reimplementado desde cero un componente que ya estaba terminado y probado.
- **Gate del wizard (AC1) resuelto en `use-pickup-wizard.ts`, consumido por
  `_layout.tsx` antes de renderizar el `<Stack>` de los 4 pasos**: `assigned` es el
  único estado real ("ready"). `assigned_unfunded` explica que el hold de fondos
  todavía no se creó (MOVO-208/ADR-021), en vez de un error genérico — es el caso
  que el propio AC1 pide cubrir explícitamente. `in_transit` (el handshake ya se
  confirmó, reingreso idempotente tras cerrar la app justo después de escanear)
  muestra "ya confirmaste este retiro" en vez de reabrir el escaneo. Cualquier otro
  estado, o un caller que no es el `carrierId` asignado, cae a un mensaje de
  bloqueo genérico con vuelta atrás. **Sin CTA real todavía** (depende del mapa de
  seguimiento de MOVO-207, en desarrollo por Pedro) — el AC1 pide un deep link para
  poder probar el flujo, que es literal: la ruta existe y funciona navegando a
  mano, sin ningún botón nuevo cableado en Home ni en `transport/[id].tsx`.
- **`HandshakeScanStep` (MOVO-160) ganó un único prop nuevo, `onEvidenceMissing`**
  (opcional, retrocompatible con la ruta standalone y `DevHandshakeScreen`, que
  siguen sin pasarlo): antes, un rechazo defensivo por
  `PICKUP_EVIDENCE_MISSING`/`DELIVERY_EVIDENCE_MISSING` (AC9 — no debería pasar si
  el gate de abajo funciona, pero el flujo tiene que degradar bien) cae al banner
  genérico sin salida. Con el prop, el wizard invalida `evidence-status` y vuelve
  al paso de evidencia en vez de dejar al usuario reintentando un escaneo que
  siempre va a fallar por el mismo motivo.
- **AC3 (paso de escaneo no accesible sin evidencia) resuelto en `scan.tsx` mismo**:
  consulta `useEvidenceStatus` (mismo query key que el paso de evidencia y que
  `EvidenceCaptureStep`, TanStack Query dedupea) y hace `<Redirect>` a `evidence` si
  todavía no está satisfecha — cubre tanto un salto directo por URL como el caso
  defensivo de arriba.
- **AC7 (reingreso con evidencia ya cargada salta al escaneo) resuelto originalmente
  en el botón "Continuar" del paso 1** consultando `evidence-status` para decidir
  `evidence` o `scan` como siguiente ruta — **revertido, ver fix post-QA más abajo**:
  saltar directo a `scan` resultó confuso incluso cuando la evidencia ya estaba
  confirmada de una corrida anterior, porque el usuario nunca había visto el paso en
  esa sesión. "Continuar" ahora siempre entra por `qr`.
- **AC4 (validación de proximidad, originalmente 150m — reducido a 100m, ver ajuste
  post-QA más abajo) es un chequeo distinto del que ya hace el handshake en sí**
  (100m entre emisor y transportista al momento de escanear, MOVO-158/160, mismo
  umbral por coincidencia, no por compartir código): acá se compara la posición
  actual del transportista contra
  `shipment.pickupLat/Lng` (la dirección del envío, estática), antes de dejarlo
  avanzar del paso 1 — `usePickupProximityCheck` (nuevo,
  `haversineDistanceKm` ya existente) bloquea "Continuar" hasta resolver
  `within_range`, con reintento manual ante `out_of_range`/`denied`/`error` (lectura
  literal del AC, "para asegurar que...").
- **AC6 (avisar que hay que pedirle el QR al emisor) es copy fijo, siempre visible
  en el paso 1**, no un tooltip descartable — el propio ticket lo señala como "la
  fricción más previsible del flujo".
- **Resultado del handshake pasado a `success.tsx` vía un `Context` acotado al
  `_layout`** (`usePickupResult`, `_layout.tsx`), no por query params: expo-router
  no serializa bien un objeto completo, y las dos pantallas viven siempre bajo el
  mismo layout. Un reingreso directo a `success` sin haber confirmado en esta
  sesión (el `Context` no sobrevive a cerrar la app) degrada a un mensaje simple con
  botón al detalle, en vez de romper.
- **AC10 (el detalle refleja `in_transit` sin depender de un refetch en el aire)**:
  el botón de `success.tsx` invalida `["shipments","detail",id]` antes de navegar.
- Fuera de alcance (igual que el propio ticket): las pantallas de evidencia/escaneo
  en sí (`MOVO-197`/`MOVO-160`, montadas tal cual); generación del QR del emisor
  (`MOVO-159`, todavía sin construir, asignada a Pedro — bloquea la prueba real de
  punta a punta con dos dispositivos); wizard de entrega (`MOVO-199`, ticket
  hermano).

Tests nuevos: `use-pickup-wizard.test.ts`, `use-pickup-proximity-check.test.ts`,
`pickup-wizard-screens.test.tsx` (gate del `_layout` + los 4 pasos), casos nuevos en
`handshake-scan-step.test.tsx` para `onEvidenceMissing`. 132/132 suites, 1014/1014
tests. `tsc --noEmit` limpio.

Pendiente / fuera de alcance: DoD de dos dispositivos reales (bloqueado por
`MOVO-159`) y prueba en dispositivo físico de cámara/GPS — no verificables en este
entorno.

**Rediseño del wizard sobre un prototipo de Claude Design (mismo ciclo, feedback
explícito del usuario: "no me gusta para nada la estética actual").** Los 4 archivos
originales (resumen+proximidad+aviso QR en `index.tsx`, `evidence.tsx`, `scan.tsx`,
`success.tsx`) pasan a 6, un propósito por pantalla, sobre el prototipo "Retiro de
paquete - flujo" (Claude Design, leído vía `DesignSync`): `index.tsx` (paso 1,
ubicación — pantalla dedicada a la proximidad de AC4, antes un widget embebido),
`resumen.tsx` **(nuevo)**, `qr.tsx` **(nuevo**, el banner amarillo de "pedile el QR"
pasa a pantalla propia, con el nombre real del emisor vía `usePublicProfile` cuando
carga), `evidence.tsx`/`scan.tsx` (mismo mecanismo/lógica, ganan el header compartido
nuevo `components/shipments/pickup-wizard-step-header.tsx` — back + "Paso N de 5" +
segmentos, mismo patrón que ya usa `transport/[id]/offer.tsx`), `success.tsx` (sin
cambios de lógica, restyle oscuro). Tres decisiones tomadas con el usuario antes de
implementar: el aviso de QR es pantalla propia (no un banner dentro del escaneo);
`EvidenceCaptureStep` (MOVO-197, compartido con el futuro wizard de entrega) no se
reescribe como viewfinder en vivo, solo se restylea el chrome alrededor; y
`HandshakeConfirmationResult` (compartido con la ruta standalone de MOVO-160 y
`/dev-handshake`) sí se restylea al lenguaje oscuro (`bg-ink-950` fijo, halo
pulsante, sin cambiar texto/props — sus tests solo verifican contenido). La paleta
del prototipo mapea 1:1 con los tokens ya existentes de `tailwind.config.js`
(`ink-950`/`lime-500`/`route-500`...), misma escala de diseño. El fondo de la
pantalla de ubicación es decorativo (grid + pulso), no un `MapView` real — sin
precedente de `Circle` de `react-native-maps` en el repo, y el valor real es el
feedback de distancia, no un mapa interactivo.

**Segunda pasada (mismo ciclo): animación de barrido en la pantalla de éxito**,
sobre un segundo prototipo de Claude Design ("Success de entrega"). Rediseño
completo de `HandshakeConfirmationResult` (antes una card estática) a una secuencia
en cascada: barrido lime desde el centro (círculo escalado con Reanimated — sin
`clip-path` real, `react-native-svg` no lo soporta de forma confiable, ver el
comentario ya existente en `app/(auth)/kyc.tsx`), check dibujado con
`strokeDashoffset` animado (mismo patrón que `AnimatedCircle` de
`publish-shipment-button.tsx`), título en cascada, y una hoja blanca inferior con
CTA horneado adentro (antes el CTA vivía afuera, a cargo de cada caller).

- **El componente pasa a fetchear sus propios datos** (`useShipment`/
  `usePublicProfile`/`useShipmentRoute`) en vez de vivir de las 5 propiedades planas
  de `ConfirmHandshakeResult` — necesita la dirección de entrega y el nombre del
  receptor para personalizar "Lo tenés vos. Ahora, a {dirección}", y la ruta/ETA
  real (`GET /shipments/route`, mismo dato que ya muestra `transport/[id].tsx`) para
  la fila "25 min · 3,4 km". Sin esto, cada uno de los 3 callers hubiera tenido que
  resolver y pasar lo mismo.
- **Sin pill de "ubicación en vivo" del mock** (decisión tomada con el usuario): no
  hay tracking en tiempo real todavía (MOVO-11/203 sin construir), afirmarlo hubiera
  sido mentir. La barra decorativa de abajo de la fila de ruta se mantuvo (no afirma
  nada por sí sola, es solo ritmo visual del reveal).
- **`onCtaPress`/`ctaLabel` nuevos, ambos opcionales**: sin `onCtaPress` no se
  muestra ningún botón (el componente sigue sin ser dueño de la navegación, mismo
  criterio de siempre) — lo usa la galería `DevHandshakeScreen`, que lo embebe en un
  box de tamaño fijo dentro de un scroll, sin ninguna acción real que ofrecer. Label
  default por stage si no se pasa uno explícito ("Ver la ruta" / "Volver al envío").
- **El CTA de retiro navega a `/route?shipmentId=...`** (pedido explícito del
  usuario, que va a construir esa pantalla de mapa/tracking en vivo aparte) — esa
  ruta no existe todavía en el repo, así que hoy cae en la pantalla "no encontrada"
  de expo-router hasta que se construya. El de entrega (sin próximo destino que
  trackear) vuelve al detalle del envío, como antes.
- `app/(app)/shipments/[id]/handshake-scan.tsx` (ruta standalone de MOVO-160) y
  `DevHandshakeScreen` actualizados al nuevo contrato — el primero perdió su propio
  footer con botón (ahora vive horneado en el componente), el segundo mockea el
  componente entero en su test (fetchea TanStack Query real y esa pantalla no tiene
  ningún `QueryClientProvider` ancestro, a diferencia del resto de la app).

Tests: `handshake-confirmation-result.test.tsx` reescrito por completo (mocks de los
3 hooks nuevos, aserciones por regex en vez de texto exacto donde hay una hora real
de por medio — timezone-dependiente); casos actualizados en
`pickup-wizard-screens.test.tsx` (CTA horneado, destino distinto por stage) y
`dev-handshake-screen.test.tsx` (mock del componente). 133/133 suites, 1053/1053
tests. `tsc --noEmit` limpio.

**Fix post-QA (mismo ciclo, reportado por el usuario en device): el paso 2 (resumen)
saltaba directo a escaneo sin pasar por el aviso de QR ni por fotos.** Era el AC7
funcionando tal como se documentó, no un bug — un envío reusado a mano durante QA
(mismo shipment, varias corridas del botón dev) ya tenía evidencia confirmada de una
corrida previa (`photoCount`/`satisfied` son acumulativos en DB, sin reset por
sesión, confirmado contra `photos.service.ts` de `svc-shipments`), así que
`evidence-status` volvía `satisfied:true` de entrada. El atajo se sacó: `pickup/
resumen.tsx#handleContinue` ya no consulta `evidence-status`, "Empezar el retiro"
siempre navega a `qr` → `evidence` → `scan`, sin importar si la evidencia ya está
confirmada — `evidence.tsx`/`EvidenceCaptureStep` (MOVO-197) igual muestran esas
fotos como ya satisfechas, así que reingresar no obliga a sacar fotos de nuevo, solo
a pasar visualmente por el paso. Test de AC7 en `pickup-wizard-screens.test.tsx`
reemplazado por uno que verifica que siempre navega a `qr`. 133/133 suites,
1053/1053 tests. `tsc --noEmit` limpio.

**Fix post-QA (mismo ciclo, pedido explícito del usuario): mapa real en el paso 1
(ubicación), no decorativo.** La primera versión del rediseño (más arriba) tenía un
fondo tipo mapa puramente estético (grid + un punto fijo en el centro, sin
coordenadas reales) — se reemplazó por un `MapView` real (mismo patrón que
`RouteMapCard`, MOVO-83/127: `PROVIDER_GOOGLE`, estilo custom `movoMapStyleDark/
Light`, truco de `MAP_EDGE_BLEED` para tapar la línea de 1px del borde nativo) con:
pin en el punto de retiro real (`shipment.pickupLat/Lng`) con badge de dirección,
pin de "vos" en la ubicación actual (`proximity.currentLocation`, GPS real) con el
mismo halo pulsante de antes, y un círculo de 150m sobre el punto de retiro (mismo
umbral que `PICKUP_PROXIMITY_THRESHOLD_METERS`, AC4) para visualizar el rango. La
distancia mostrada en el panel inferior sigue siendo la misma (GPS real vía
`haversineDistanceKm`), ahora formateada con `formatProximityDistance` nueva
(`shipment-format.ts`: metros enteros bajo 1km, un decimal en km por encima).

- **`usePickupProximityCheck` gana `currentLocation: {lat,lng} | null`** (antes solo
  exponía `distanceMeters`) — necesario para poder plotear el pin de "vos" en el
  mapa, no solo mostrar la distancia como texto.
- **`mapRef.fitToCoordinates` se dispara en dos momentos**: cuando el mapa termina
  de montarse (`onMapReady`) y de nuevo cada vez que `currentLocation` cambia — el
  GPS suele tardar más que el montaje del `MapView`, así que sin el segundo trigger
  el mapa quedaría encuadrado solo en el punto de retiro aunque la ubicación actual
  ya esté resuelta.
- **Mock de `react-native-maps` (`test/mocks/react-native-maps-mock.js`) suma
  `Circle`** (antes solo `MapView`/`Marker`/`Polyline`) — mismo criterio que el
  resto del mock, una `View` plana sin lógica nativa.

Tests nuevos: `formatProximityDistance` en `shipment-format.test.ts`, caso de
`currentLocation` en `use-pickup-proximity-check.test.ts`, dos casos nuevos en
`pickup-wizard-screens.test.tsx` (mapa con ambos pines, sin pin de "vos" mientras el
GPS no resolvió). 133/133 suites, 1056/1056 tests. `tsc --noEmit` limpio.

**Segundo ajuste (mismo día, feedback directo sobre el mapa real recién agregado):
pines chicos, badges sin identidad, sin medición visible, demasiado zoom.**

- **Pines más grandes**: pin de retiro 14px→24px, pin de "vos" 16px→24px (borde
  3px en vez de 2px en ambos), halo pulsante 54px→64px.
- **Badge del pin de retiro pasa de la dirección al nombre del emisor**
  (`usePublicProfile(shipment.senderId)`, mismo hook que ya usa `pickup/qr.tsx` —
  comparte query key, sin request de más) — la dirección ya se lee en el paso 2
  (resumen), acá lo que importa es reconocer a la persona.
- **Badge "Vos" nuevo sobre el pin del transportista** (antes sin ninguna etiqueta).
- **Chip de distancia flotante al pie del mapa** (`pickup-geo-map-distance`, ícono
  `Ruler` + `formatProximityDistance`) — la distancia ya estaba en el texto del
  panel inferior ("Estás a X m del punto"), pero ese texto explica un estado, no
  mide; el chip nuevo es una lectura numérica siempre visible mientras el GPS
  resolvió, coexiste con el texto sin duplicar su propósito.
- **Línea punteada entre ambos pines, agregada y sacada en la misma pasada** (feedback
  explícito del usuario: no era parte de lo pedido) — quedó fuera, sin `Polyline` en
  el mapa de este paso.
- **Menos zoom**: `latitudeDelta`/`longitudeDelta` inicial 0.01→0.018, `edgePadding`
  de `fitToCoordinates` 80/60→110/90 — con los pines más grandes y las dos etiquetas
  nuevas, el encuadre anterior los dejaba pegados a los bordes del mapa.

Tests nuevos en `pickup-wizard-screens.test.tsx` (chip de distancia visible/oculto
según `distanceMeters`). 133/133 suites, 1058/1058 tests. `tsc --noEmit` limpio.

**Tercer ajuste (mismo día, pedido explícito del usuario): el badge de estado ("En
el punto"/"Fuera de rango", antes flotando arriba a la izquierda) se integró en la
misma pill que la distancia**, al pie del mapa — antes eran dos elementos flotantes
separados (badge arriba, chip de distancia abajo). Ahora es una sola pill
(`pickup-geo-map-status`) con dot + label de estado + divisor vertical + distancia
(`pickup-geo-map-distance`, testID conservado en el `Text` interno). El testID viejo
del badge de arriba se eliminó — ya no existe ese elemento. Test nuevo verificando
que ambos textos conviven en la misma pill. 133/133 suites, 1059/1059 tests.
`tsc --noEmit` limpio.

**Cuarto ajuste (mismo día, pedido explícito del usuario): "Reintentar ubicación"
ocupa el lugar de "Continuar" cuando no se puede avanzar por distancia.** Antes
convivían un botón chico "Reintentar ubicación" (dentro del panel de estado) y el
botón principal "Continuar" deshabilitado, uno arriba del otro — dos botones a la
vez, uno de ellos inerte. Ahora es un solo `PrimaryButton` por vez: con
`out_of_range`/`denied`/`error`, el botón principal ES "Reintentar ubicación"
(`pickup-geo-retry`, mismo estilo/tamaño que "Continuar", ya no un `Pressable`
chico secundario); con `within_range` es "Continuar" habilitado; con `idle`/
`checking` sigue siendo "Continuar" deshabilitado (todavía no hay nada que
reintentar, el chequeo inicial corre solo). `canRetry` nueva deriva cuál de los dos
`PrimaryButton` renderizar.

Tests: el caso viejo que probaba "Continuar" deshabilitado con `out_of_range`
(testID que ya no existe en ese estado) se reemplazó por uno con `idle`/`checking`;
`it.each` nuevo cubriendo los 3 estados de reintento, verificando que
`pickup-geo-continue` no existe mientras se puede reintentar. 133/133 suites,
1061/1061 tests. `tsc --noEmit` limpio.

**Quinto ajuste (mismo día, bug reportado en device): el halo pulsante del pin
"vos" se veía recortado por una máscara cuadrada en su punto más expandido.**
`Marker` (react-native-maps) rasteriza su contenido al tamaño que mide la `View`
raíz que le pasás — el contenedor del halo estaba fijo en 64×64px mientras
`LocationPulse` escala su halo base (54px) hasta 1.8x (~97px de diámetro en el
pico del pulso), así que todo lo que se pasaba de esos 64px quedaba cortado en un
cuadrado en vez de dejarse ver como círculo. `PULSE_MARKER_SIZE` ahora se calcula
a partir de `PULSE_BASE_SIZE`/`PULSE_MAX_SCALE` (con margen) en vez de un número
fijo — el contenedor del marcador siempre queda más grande que el halo en su punto
más expandido, sin importar si alguno de los dos valores cambia después. 133/133
suites, 1061/1061 tests. `tsc --noEmit` limpio.

**Séptimo ajuste (mismo día, pedido explícito del usuario): radio de proximidad
reducido de 150m a 100m.** `PICKUP_PROXIMITY_THRESHOLD_METERS`
(`use-pickup-proximity-check.ts`) — único lugar de donde sale el valor real (el
círculo del mapa, el copy de "Acercate y volvé a probar" y el gate de "Continuar"
lo consumen todos de esa misma constante, sin ningún 150 hardcodeado en otro lado).
Coincide ahora, por casualidad y no por compartir código, con el umbral de 100m que
ya usa el handshake en sí (MOVO-158/160) al validar distancia emisor↔transportista
en el momento de escanear. 133/133 suites, 1061/1061 tests. `tsc --noEmit` limpio.

### MOVO-151 — "Mis ofertas": listado completo con tabs, avisos y estado vacío accionable

Cierra el pendiente que dejaron documentado MOVO-183 y MOVO-182 ("el listado completo
del ticket original sigue sin construirse"): `carrier/offers/index.tsx` pasa de una
lista plana sin filtrar a tabs **Activas** (default, AC4) / **Cerradas**, ahora
apoyada en los tres contratos de backend que este mismo refinamiento de ciclo había
dejado bloqueantes y que ya llegaron a `develop` (MOVO-185 distancia/paquete, MOVO-186
neto real, MOVO-188 ranking competitivo).

- **`components/transport/my-offer-card.tsx` nueva** (pedida explícitamente por el
  ticket): reemplaza la fila de una sola línea — ahora con fecha de retiro + distancia
  (`shipment.distanceKm`), el neto real (`priceNetArs`, no el bruto `priceOffered`) y
  un chip de estado con copy explicativo (`offerStatusLabel`, AC3, nunca el enum
  crudo).
- **"Requieren algo tuyo" reformulada**: antes solo `accepted`; ahora suma las
  `pending` que no lideran su ranking (`competitiveRank.rank > 1`), con el aviso
  "Quedaste 4.º de 5. Bajando a $X pasás al frente" (`competitiveRankNotice` nuevo en
  `offer-format.ts`) — el aviso que el refinamiento de MOVO-151/182 había dejado
  explícitamente "fuera de alcance hasta que exista el contrato" (MOVO-188), ya
  resuelto. El resto de las `pending` (liderando) cae en una sección "El resto" sin
  aviso — una card sin aviso no necesita destacarse.
- **AC5/AC6 sin duplicar acciones**: una oferta `accepted` navega directo al envío
  asignado (`/transport/:id`); el resto navega al detalle real de la oferta
  (`carrier/offers/[id]`, MOVO-182), que ya tiene retirar/modificar — reusa esa
  pantalla en vez de repetir el botón "Retirar" en cada card de la lista.
- **AC7**: el estado vacío (sin ninguna oferta) suma un CTA "Ver envíos disponibles"
  que vuelve al tab Transportar — antes era solo texto. Vacío de un tab con ofertas en
  el otro (ej. todo activo, tab Cerradas vacío) es un mensaje corto sin CTA, caso
  distinto del AC7 literal.
- **AC1 del ticket ("segmentador dentro de Transportar, no una pantalla aparte") no
  se tomó literal**: se mantuvo como ruta separada (`/carrier/offers`, ya así desde
  MOVO-183, con dos accesos con contador en `TransportAccessCards`) en vez de
  refactorizar a un segmentador embebido — reescribir esa navegación ya probada solo
  para calzar con el texto original del AC, escrito antes de que el mockup de
  Claude Design mostrara una pantalla dedicada con sus propios tabs internos
  (Activas/Cerradas, lo que sí se construyó acá), no aportaba nada al usuario.
- Hero "En juego"/"Confirmado" corregido para sumar `priceNetArs` (antes sumaba el
  bruto `priceOffered` — quedaba mal versus el "te queda $X" de cada card).

Tests nuevos: `test/my-offer-card.test.tsx`, `test/my-offers-summary-screen.test.tsx`
reescrito contra el comportamiento con tabs (default Activas, agrupación en avisos,
navegación AC5/AC6, ambos vacíos). 128/128 suites, 998/998 tests en `movo-mobile`.
`tsc --noEmit` limpio (de paso se detectó y corrigió, de nuevo, un `dist/` local
desactualizado de `@movo/shared` — no es parte del diff de esta US, build artifact
gitignorado).

**Cierre de la US (skill `cerrar-us`), dos gaps reales encontrados contra el
texto literal del ticket, corregidos antes de cerrar:**

- **AC3: `EXPIRED` no coincidía con el ejemplo literal del AC** ("venció antes de
  que respondieran") — `offerStatusLabel` (`offer-format.ts`, no tocado por este
  ticket hasta ahora) decía solo `"Venció"`. Corregido al texto exacto del AC.
  `offerStatusBannerCopy` (detalle de oferta, MOVO-182) no se tocó: ya era
  plenamente explicativo con título+subtítulo separados.
- **DoD ("render de cada estado con su copy correspondiente") solo cubría
  `pending`/`superseded`**: `my-offer-card.test.tsx` pasó a un `it.each` con los 6
  estados. Suite final: 128/128 suites, 1003/1003 tests, `tsc --noEmit` limpio.
- **AC2 ("tratamiento visual distinto" para los 6 estados), deviación aceptada,
  no corregida**: `withdrawn`/`expired`/`superseded` comparten el mismo chip mute
  (`bg-bg-mute`), solo distinto texto — únicamente pending/accepted/rejected
  tienen color propio. Se decidió no rediseñar el chip para 3 estados "cerrados,
  sin acción posible" con la misma US ya cerrada por lo demás; queda anotado como
  posible ajuste visual menor, no un bug funcional (el texto sigue siendo
  explicativo en los tres casos).
- **AC1 (segmentador embebido en Transportar) confirmado como no aplicable**, ver
  el punto de arriba — decisión ya tomada en MOVO-183, no de este ticket.

**Fixes de review (PR #177):**

- **El chip de estado de `MyOfferCard` perdía su color**: `bg-*` y `text-*` iban juntos
  en el `View` contenedor y el `Text` interno no tenía color propio — en RN/NativeWind
  el color de texto no se hereda de un `View`. Ahora son dos mapas
  (`STATUS_CHIP_BG_CLASS`/`STATUS_CHIP_TEXT_CLASS`), con test que fija la clase en el
  propio `Text`.
- **Una `pending` sobre un envío `cancelled` ahora "requiere algo tuyo"**: cancelar un
  envío no cierra sus ofertas `pending` (solo notifica), y llegan con
  `competitiveRank: null` — antes caían en "El resto" como una oferta viva más. Sigue
  sumando al hero "En juego" (no se tocó el total).
- **Tab Cerradas recupera contador y cuándo se ofertó** (`Cerradas (N)`,
  `MyOfferCard#showSentAgo` → `formatOfferedAgo`), que tenía la lista plana anterior.
- `router.replace` del CTA del estado vacío se dejó a propósito: es un tab, y `push`
  apilaría una segunda copia del grupo `(tabs)` sobre la de abajo.

Pendiente / fuera de alcance: no probado en dispositivo; el footer "Las ofertas
pendientes se cierran solas..." del mockup solo se muestra en el tab Activas cuando
hay al menos una `pending`, sin verificar contra el comportamiento real de expiración
del backend (ya lo cubre MOVO-145 del lado servidor, esto es solo copy).
### MOVO-159 — Pantalla de generación de QR con countdown (cedente de custodia) (`movo-mobile`)

Implementación completa de la pantalla de transferencia de custodia física vía código QR dinámico para el cedente (emisor en retiro, transportista en entrega). Diseñada según el manual de marca de Movo y el artefacto de Claude Design (`viaje_del_transportista.dc.html`).

- **Dependencia instalada**: `react-native-qrcode-svg@6.3.24` (renderizado de QR vectorial nativo en SVG).
- **Cliente API (`src/api/shipments-client.ts`)**: `generateHandshake(shipmentId, { lat, lng })` conectando con `POST /shipments/:id/handshake/generate`.
- **Hook `useHandshakeQr` (`src/hooks/use-handshake-qr.ts`)**:
  - Gating con `useDeviceKeyBootstrap()` si el estado de la clave del dispositivo no es `"ready"`.
  - Captura obligatoria de coordenadas GPS vía `getCurrentLocation()` para validar geofence de 100m.
  - Firma client-side del payload canónico retornado por el backend utilizando `signHandshakeNonce` (MOVO-195).
  - Ensamblado del payload JSON convenido con el receptor (`MOVO-160`): `{"shipmentId": "...", "nonce": "...", "signature": "..."}`.
  - Contador regresivo sincronizado contra el `expiresAt` autoritativo del backend (`new Date(generated.expiresAt).getTime()`, con fallback a `ttlSeconds`), mitigando desincronizaciones de reloj y latencia de red en la expiración del nonce. Transición a color de advertencia (`#E5484D`) en los últimos 5 segundos, y estado de expiración a los 0 segundos con opacidad atenuada (0.2).
  - Botón de regeneración manual para solicitar y firmar un nuevo nonce tras expirar.
  - Polling a `shipmentsClient.getById(id)` cada 2.5 segundos para detectar el avance de estado cuando el receptor completa el escaneo (`IN_TRANSIT` para retiro, `DELIVERED`/`COMPLETED` para entrega), transicionando inmediatamente a `"confirmed"` (reemplazable por WebSocket en `MOVO-201`).
- **Componentes (`components/handshake/` & `components/ui/`)**:
  - `MovoIsotype` (`components/ui/movo-isotype.tsx`): Implementación vectorial nativa en SVG del isotipo oficial según el Manual de Marca (`#movo-logo-dark`, 5 círculos concéntricos de apertura y esquinas redondeadas al 20%).
  - `HandshakeQrCard`: Contenedor idéntico al prototipo con QR de 186×186, isotipo oficial de Movo en el badge central (44×44), reloj monoespaciado (`00:15`), barra de progreso animada, overlay de expirado, y simulación en `__DEV__`.
  - `HandshakeSuccessView`: Pantalla de éxito con badge circular de check (64×64), paleta contextual de marca (fondo oscuro con tilde lima para retiro; fondo lima con tilde oscuro para entrega), tipografía Inter centrada, tabla resumen de envío y estado diferenciando `ShipmentStatus.COMPLETED` ("El envío figura como completado y el pago fue acreditado") de `DELIVERED` ("Estamos procesando el pago"), y botones de acción para volver al envío o a Inicio. Dispara vibración háptica de éxito (`Haptics.notificationAsync`).
  - `HandshakeDeviceKeyWarning`: Banner de advertencia si la clave criptográfica del dispositivo está pendiente o en error con botón de reintento.
- **Pantalla y Navegación**:
  - Ruta `app/(app)/shipments/[id]/handshake.tsx`: Resuelve automáticamente el rol del usuario autenticado (emisor entrega paquete al transportista → "pickup"; transportista entrega paquete al destinatario → "delivery") y el nombre de pila de la contraparte desde su perfil público.
  - Botón de acceso contextual en `app/(app)/shipments/[id].tsx`: Botón inferior con estilo lime "Confirmar retiro" para el emisor en estado `ASSIGNED`, y "Confirmar entrega" para el transportista en estado `IN_TRANSIT`.
  - Acceso a pantalla de desarrollo (`/dev-handshake`) consolidado en la pestaña de Perfil (`profile.tsx`), manteniendo la pantalla Home limpia.
  - Imports de `@movo/shared` apuntando a subpaths específicos (`@movo/shared/dist/types/shipment`, `@movo/shared/dist/errors/api-error`) para prevenir fugas de librerías Node (`node:crypto`, `jsonwebtoken`) en el runtime nativo.
- **Tests**:
  - `test/use-handshake-qr.test.tsx` (9 tests: AC2 generación y firma, AC2/AC3 countdown y expiración sincronizada con `expiresAt` autoritativo del backend, AC3 regeneración, AC4 polling de confirmación, AC5 GPS denegado y distancia excedida, pruebas de latencia de red, expiración inmediata en tránsito y fallback de TTL). Utiliza el patrón `Harness` con `render` para evitar el bug de `renderHook` de React 19 / RNTL 14.
  - `test/handshake-qr-card.test.tsx` (5 tests: render normal, cuenta regresiva en rojo, overlay de expiración y botón de regenerar, estado de carga, errores).
  - `test/handshake-success-view.test.tsx` (3 tests: retiro, entrega en estado `DELIVERED` informando procesamiento de pago, entrega en estado `COMPLETED` informando acreditación de pago, y navegación).
  - `test/handshake-device-key-warning.test.tsx` (3 tests: ready, pending, error con reintento).
  - `test/handshake-screen.test.tsx` (4 tests: resolución de rol emisor/transportista, advertencia de clave, transición a éxito).
  - `test/shipment-detail-screen.test.tsx` (3 tests nuevos para el botón contextual).
  - Suite completa: 132/132 suites, 1007/1007 tests pasando. `npx tsc --noEmit` sin errores.

### MOVO-236 — Aviso de viaje auto-creado tras aceptar una oferta sin viaje asociado

Frontend de MOVO-234 (backend, ya en `develop`): cuando se acepta una oferta sin
`tripId`, el backend crea un `Trip` `declared` y dispara una push
`{ type: "trip_auto_created", tripId }` (sin `shipmentId`) vía
`dispatchAutoTripCreatedPush` en `offers.service.ts` — título/body ya vienen fijados
por el backend, así que este ticket es routing + fallback in-app, no copy de la push.

- **AC1 (push)**: `resolveNotificationRoute` (`use-push-notifications.ts`) generaliza
  la rama de `trip_match` a `TRIP_ROUTE_NOTIFICATION_TYPES = ["trip_match",
  "trip_auto_created"]` — mismo destino, `/(app)/(tabs)/transport?tripId=`. **No existe
  una pantalla de "detalle de viaje"** pese a que el ticket la menciona (MOVO-162 solo
  tiene lista/alta/edición) — el feed filtrado por `tripId` es lo más parecido a "ver
  este viaje" que ya usa `TripCard.onPress`, mismo criterio que ya adoptó `trip_match`
  (MOVO-163).
- **AC2 (fallback in-app sin push)**: sin ningún flag de backend que distinga un `Trip`
  auto-creado de uno declarado a mano (AC3 de MOVO-234), y sin ningún mecanismo previo
  en el repo para detectar "mi oferta fue aceptada" fuera de la push (ni siquiera
  `offer_accepted` lo tiene) — se resolvió con diffing local: `src/lib/seen-trips.ts`
  persiste el set de `tripId`s vistos por dispositivo (`secureStore`, key
  `carrierSeenTripIds` — **no** `AsyncStorage`, mismo criterio ya documentado en
  `transportRadiusKm`, no amerita una dependencia nueva). "Mis viajes"
  (`carrier/trips/index.tsx`) diffea en cada carga de `useMyTrips()` y muestra un
  segundo `SuccessBanner` si aparece un `tripId` nuevo; la primera vez que corre en un
  dispositivo siembra sin avisar (evita falsos positivos sobre viajes preexistentes).
  `useCreateTrip` marca el id como visto en su propio `onSuccess`, antes de que la
  pantalla llegue a diffear — así "Declarar viaje" (que ya tiene su propio aviso,
  `?created=1`) nunca dispara también el banner de auto-creado para ese mismo viaje.
  Simplificación aceptada: si ambos casos coinciden en la misma carga, `created=1`
  tiene prioridad visual y el otro id se marca visto en silencio esa vez (edge case
  raro, no amerita apilar dos banners).
- **AC3**: no tocado — ya lo garantiza el propio `Trip` auto-creado del lado backend
  (sin campo ni indicador visual distinto).

Tests: `test/seen-trips.test.ts` (siembra inicial sin aviso, diff incremental,
`markTripAsSeen` idempotente y previniendo el diff), `test/use-trips.test.ts` nuevo
(`useCreateTrip` marca el id creado como visto), casos nuevos en
`test/use-push-notifications.test.tsx` (`trip_auto_created` con/sin `tripId`) y
`test/my-trips-screen.test.tsx` (banner simple/plural, sin viajes nuevos no muestra
nada, prioridad de `created=1` sobre el banner de auto-creado). Suite completa
verificada: 967/974 tests pasando, los 7 que fallan son preexistentes y no relacionados
(`@noble/curves`, `@react-native-menu/menu`, `expo-camera`,
`react-native-qrcode-svg` — módulos nativos no instalados en este checkout, mismo gap
que ya reporta `tsc --noEmit`).

Pendiente / fuera de alcance: copy final del push y del banner (placeholder razonable,
mismo criterio que el resto del repo); auth de `movo-admin`/MOVO-33 no aplica acá (es
mobile-only).
### MOVO-207 — Mapa de ruta optimizada multi-parada, paradas ordenadas, ETA y recálculo

Pantalla completa de itinerario y mapa de ruta optimizada para el transportista (`app/(app)/route/index.tsx`), consumiendo `GET /shipments/my-route` (MOVO-206) y el solver VRPTW. Acceso desde la pestaña Transportar (`app/(app)/(tabs)/transport.tsx`, "Mi ruta de hoy").

- **`components/route/route-map.tsx` (nuevo)**: mapa Google Maps con marcadores numerados según orden del algoritmo (AC2), diferenciación visual coherente con Claude Design (cuadrado con borde blanco para retiros, círculo con borde blanco para entregas, fondo negro con número blanco, rojo ante demora fuera de ventana AC5). Ubicación actual del transportista (punto verde lima con borde blanco) y origen del viaje (círculo blanco con punto interior).
- **Controles flotantes estilo Google Maps & Stitch**: botón individual conmutado que alterna entre "Centrar" (seguimiento continuo del conductor) y "Ver ruta" (visión completa del recorrido), botón "Abrir en Maps" con deep link externo (Google Maps / Apple Maps) y feedback toast situado debajo de la isla superior.
- **`components/route/stop-list.tsx` (nuevo)**: sheet inferior con header fijo y scrollview interno para las paradas. Soporte táctil y de arrastre continuo (`PanResponder` nativo suave con físicas de resorte) desde el drag handle superior pill y header, respondiendo a toques y arrastre sin interferencias de scroll.
- **`src/hooks/use-optimized-route.ts` (nuevo)**: maneja carga, errores, obtención de GPS foreground estricta sin coordenadas inventadas (AC8), y recálculo automático al volver a la pantalla tras completar una parada en un wizard vía `useFocusEffect` (AC7).
- **ETA como estimación (AC11)**: todos los tiempos estimados se formatean explícitamente con copy "aprox." (`formatEstimatedArrival`).
- **Modo Demo para desarrollo (`__DEV__`)**: accesible desde el estado vacío ("Sin paradas asignadas"), error o sin GPS en builds de desarrollo, permitiendo visualizar la ruta completa con polilínea trazada (Córdoba → Las Mulitas → Oncativo → Villa María) e interactuar con el flujo sin tener que generar manualmente viajes con estados complejos en base de datos.
- **Acción contextual por parada (AC9)**: la parada activa ofrece el CTA principal ("Retirar paquete" / "Entregar paquete") navegando directamente a sus respectivos wizards (`/shipments/:id/pickup` o `/shipments/:id/delivery`) vía `onPressAction`, diferenciado del enlace secundario "Ver envío" (`onPressShipment`) que lleva al detalle.
- **Centrado de cámara, sincronización bidireccional y navegación multi-parada en Google Maps**: `RouteMap` utiliza `StyleSheet.absoluteFill` para garantizar un renderizado robusto en iOS/Yoga sin colapsos de altura. El botón "Abrir en Maps" genera una ruta completa multi-parada secuenciada respetando el `stopOrder`, configurando el origen (GPS del transportista o dispositivo), paradas intermedias ordenadas (`waypoints`) y destino final en la última parada.
- **Sincronización bidireccional y selección visual (AC4)**: Cualquier parada puede seleccionarse en el mapa o bottom sheet para desplegar su detalle individual con "Ver envío". El botón de acción rápida ("Retirar/Entregar paquete") se reserva exclusivamente para la próxima parada activa, sin sombras superfluas (`shadow-sm` removido) y con tokens consistentes (`h-11`, `rounded-[10px]`).
- **Distinción visual estricta de paradas**: Cuadrado redondeado (`borderRadius: 8`) para retiros y círculo completo (`borderRadius: 999`) para entregas, con fondo `#0A0A0B` (o `#E5484D` por demora) y número blanco de alto contraste sin artefactos de borde subpíxel.
- **Formato de duración y ETA amigable**: Función `formatDuration` que convierte minutos a formato legible (ej. `115 min` a `1h55min`, y `< 60` a `X min`).
- **Spinner nativo consistente**: `RefreshControl` y loading con spinner en negro `#0A0A0B`.
- **Prevención de marcadores congelados en refetch (AC5)**: `tracksViewChanges` incorpora `stops` en su array de dependencias (`[selectedStopOrder, activeStopOrder, stops]`) para re-habilitar el snapshotting nativo durante 600ms ante refetches o cambios de ventana horaria (`outsideTimeWindow`), asegurando que el marcador cambie de color inmediatamente.
- **Prevención de race conditions y limpieza de errores**: `useOptimizedRoute` incorpora un contador de secuencia (`requestSeqRef`) e invalidación en pérdida de foco para descartar respuestas desfasadas, y limpia `route` ante un refetch fallido.
- **Actualización manual con pull-to-refresh**: `StopList` integra `RefreshControl` y tipado estricto `GestureResponderHandlers` (sin `any`), además de un botón de refresco manual en la isla superior durante viajes activos.
- **Cliente HTTP consistente**: `shipmentsClient.getMyRoute` utiliza el objeto `query` de `httpClient.get` y `getById` mantiene aislamiento estricto sin scope creep de demo.

- **Compatibilidad con MOVO-235 (`tripId`)**: `shipmentsClient.getMyRoute(coords, tripId?)` y `useOptimizedRoute(tripId?)` preparados para aceptar opcionalmente un `tripId` (por parámetro y por query param en `/route?tripId=...`), manteniendo retrocompatibilidad total si no se envía.

### MOVO-244 — Batch de fixes: KYC, TyC obligatorios, sincronización de estado y varios de UI (`movo-mobile`)

Batch de correcciones y mejoras funcionales y de UI en `movo-mobile`:
- **KYC en revisión (`manual_review`)**: rediseño de la pantalla de revisión de DNI (`app/(auth)/kyc.tsx`) y licencia (`app/(app)/license-kyc.tsx`) según lineamientos Stitch. Card con isotipo/reloj de arena, copy con plazos claros (24-48 hs), eliminación del enlace "Ir al inicio" en verificación de DNI (el usuario no verificado no debe acceder a la app) y botón primario estandarizado `PrimaryButton` con padding seguro inferior. Soporte de visualización rápida vía query param `?status=manual_review` y acceso dev en Perfil (`__DEV__`).
- **Términos y condiciones obligatorios**: `components/legal/legal-entry-sheet.tsx` documenta `onDismiss?: () => void` opcional para retrocompatibilidad pero mantiene comportamiento modal estricto. En `/profile/legal/index.tsx` se bloquea el botón volver (chevron y botón físico de Android) cuando hay TyC pendientes de aceptación.
- **Pull-to-refresh y offsets**: agregado `RefreshControl` en Inicio (`app/(app)/(tabs)/home.tsx`) y Detalle de Envío (`app/(app)/shipments/[id].tsx`) con `progressViewOffset={32}` para evitar solapamientos con la barra de navegación.
- **Aceptación de ofertas y redirect**: al aceptar una oferta en `offers.tsx`, se invalida y refetchea `['shipments', 'detail', id]` y `ChooseOfferSuccessModal` muestra animación de barra de progreso con feedback háptico (`Haptics.notificationAsync`) antes de redirigir automáticamente al detalle del envío con el transportista asignado.
- **Formateo de tiempos de ruta**: `src/lib/shipment-format.ts` (`formatDurationMin`) formatea en horas y minutos (`X h Y min` / `X h`) cuando $\ge 60$ min. En `transport/[id].tsx` se mantiene en una sola línea (`shrink-0`, `numberOfLines={1}`).
- **Zoom de foto de perfil**: long press con feedback háptico (`Haptics.impactAsync`) sobre el avatar de perfil abre `PhotoViewerModal` tanto en el perfil público (`profile/[id].tsx`) como en el propio (`(tabs)/profile.tsx`).
- **Copy de precio en vista emisor y precio pactado**: se reemplazó "Precio sugerido" por "Costo aproximado" en `components/send/price-preview-card.tsx`. En Detalle de Envío (`app/(app)/shipments/[id].tsx`), al aceptar una oferta o contar con transportista asignado se exhibe la etiqueta "Precio pactado" (precio final/confirmado, no aproximado), resolviendo la omisión de persistencia de `agreedPriceArs` en `offer-repository.ts#acceptOffer` e integrando fallback defensivo en `getShipmentDetail`.
- **Handshake success**: extensión de un ~25-30% de la duración de las animaciones en `components/handshake/handshake-confirmation-result.tsx`.
- **Estado de envío `ASSIGNMENT_PENDING`**: se mantuvo texto "Sin asignar" conforme a que la saga completa de asignación y reserva de fondos corresponde a MOVO-210 / MOVO-208 / MOVO-209 / MOVO-211.

