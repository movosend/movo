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
  - **Aceptar envío**: CTA primaria con acento Signal Lime (`bg-lime-500`, texto oscuro), pide confirmación con diálogo nativo `Alert.alert` y ejecuta `POST /shipments/:id/accept`.
  - **Rechazar**: botón secundario/destructivo que abre modal de confirmación con advertencia de irreversibilidad y campo opcional para motivo (`reason`, máx 500 caracteres, `POST /shipments/:id/reject`).
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
  `Verificado` **solo en la fila del teléfono**. El email no lleva ninguno a propósito —
  no existe concepto de verificación de email en todo el sistema (sin columna
  `email_verified` ni `EmailProvider`; por eso el OTP del cambio de email va al teléfono),
  así que un chip verde ahí sería falso y uno gris de "sin verificar" sería un pendiente
  que el usuario no puede resolver. Obligó a exponer `phoneVerified` en `PrivateProfile`,
  mismo movimiento que el DNI.

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
