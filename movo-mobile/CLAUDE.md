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

Pendiente / fuera de alcance: cancelar envío (MOVO-29), detalle/lista de ofertas
(MOVO-17), handshake/tracking en vivo (MOVO-6/MOVO-11) — igual que documenta el
propio ticket.

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
- **AC6 (navegar al detalle de un envío) queda parcialmente resuelto a propósito**: el
  listener (`addNotificationResponseReceivedListener`) parsea `data.type === 'shipment'`
  y deja el punto de extensión documentado en el propio código, pero no navega a
  ningún lado real — no existe ninguna pantalla de envíos todavía (MOVO-83+, sin
  arrancar). Decisión tomada con el usuario: mejor dejar el parseo listo y sin acción
  que inventar un destino (`/home`) que no es el real.
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
