/**
 * `app.config.js` en vez de `app.json` (MOVO-73): `app.json` es estático y SÍ se
 * trackea en git — cualquier valor pegado ahí (como una API key) queda commiteado
 * para siempre. `app.config.js` corre en Node en build/prebuild time y sí puede leer
 * `process.env`, que Expo CLI ya carga automáticamente desde `.env.local` (gitignored)
 * en local, o desde el bloque `env` de cada perfil de `eas.json` en builds de EAS —
 * mismo mecanismo que ya usa `EXPO_PUBLIC_API_URL`, pero estas dos no llevan el
 * prefijo `EXPO_PUBLIC_` a propósito: no hace falta que viajen embebidas en el bundle
 * JS (`app.config.js` las consume una sola vez, en build time, para generar
 * `Info.plist`/`AndroidManifest.xml`), así que no corresponde tratarlas como variable
 * pública de runtime.
 *
 * Son las keys de **renderizado de mapa** (Maps SDK, restringidas por bundle id/SHA
 * fingerprint en la consola de Google Cloud) — distintas de `GOOGLE_MAPS_API_KEY` del
 * backend (`services/movo-svc-users`), que es la key de **Geocoding API**, server-side,
 * restringida por IP. Ver `.env.example` para cómo conseguir ambas.
 */
// MOVO-107: instalar `expo-notifications` agrega el entitlement `aps-environment` al
// proyecto iOS **sin importar si el plugin figura en `plugins` acá abajo** — Expo
// autolinkea un mod de entitlements implícito (`withIosExpoPlugins`) para cualquier
// paquete de notificaciones instalado, corra o no explícitamente el plugin (verificado
// con `EXPO_DEBUG=1 npx expo prebuild`: el mod `withExpoNotifications` corre igual con
// el plugin sacado de la lista de abajo). Esa capability no la puede firmar un team
// personal de Apple ("Personal Team", el que usa `expo run:ios` con un Apple ID
// gratis): Xcode rechaza el provisioning profile entero ("Personal development teams
// ... do not support the Push Notifications capability"), tumbando el build completo,
// no solo push. Como sacar el plugin de `plugins` no alcanza, se agrega
// `withoutPushEntitlement` al final del array — un mod propio que borra
// `aps-environment` del `.entitlements` generado después de que el autolinking lo
// puso — gateado detrás de `ENABLE_PUSH_NOTIFICATIONS` (default `false`, mismo
// criterio que `SMS_PROVIDER=console`/`GEOCODING_PROVIDER=mock`: capability real
// reservada para cuando haga falta probarla, no prendida por default en local). Sin
// la entitlement, `expo-notifications` sigue andando en JS (`getExpoPushTokenAsync`
// tira y ya se atrapa en `push-registration.ts`, MOVO-107), solo no queda declarada
// la capability nativa. Los builds de EAS (`eas.json`) sí la necesitan real: seteá
// `ENABLE_PUSH_NOTIFICATIONS=true` como EAS Environment Variable en los perfiles que
// vayan a probar push de punta a punta, una vez que el team de Apple sea de pago.
const { withEntitlementsPlist } = require("expo/config-plugins");

const PUSH_NOTIFICATIONS_ENABLED = process.env.ENABLE_PUSH_NOTIFICATIONS === "true";

const withoutPushEntitlement = (config) =>
  withEntitlementsPlist(config, (config) => {
    delete config.modResults["aps-environment"];
    return config;
  });

module.exports = {
  expo: {
    name: "Movo",
    slug: "movo-mobile",
    owner: "movosend",
    version: "1.0.0",
    scheme: "movo",
    orientation: "portrait",
    userInterfaceStyle: "automatic",
    ios: {
      icon: "./assets/ios-icon.icon",
      supportsTablet: true,
      bundleIdentifier:
        process.env.IOS_BUNDLE_ID ?? `com.movosend.movomobile.${process.env.USER ?? "dev"}`,
      infoPlist: {
        NSCameraUsageDescription:
          "Movo necesita la cámara para escanear tu documento y tomar una selfie durante la verificación de identidad con Didit.",
        NSMicrophoneUsageDescription:
          "Movo necesita el micrófono para grabar el video de verificación de vida durante la verificación de identidad con Didit.",
        NSPhotoLibraryUsageDescription:
          "Movo necesita acceso a tus fotos para subir imágenes de tu documento durante la verificación de identidad con Didit.",
        NFCReaderUsageDescription:
          "Movo usa NFC para leer el chip de tu pasaporte durante la verificación de identidad con Didit.",
        NSLocationWhenInUseUsageDescription:
          "Movo usa tu ubicación para ayudarte a marcar el punto exacto de tu dirección en el mapa durante el registro.",
        // Permite tráfico HTTP plano hacia direcciones de red local (RFC1918/.local) sin
        // afectar ATS para el resto de internet — necesario para probar un development
        // build en un iPhone físico contra el backend corriendo en la LAN (override desde
        // /dev-connection). Sin esto, iOS bloquea el fetch a http://192.168.x.x:... aunque
        // la app y el backend estén en la misma red.
        NSAppTransportSecurity: {
          NSAllowsLocalNetworking: true,
        },
      },
    },
    android: {
      adaptiveIcon: {
        backgroundColor: "#E6F4FE",
        foregroundImage: "./assets/android-icon-foreground.png",
        backgroundImage: "./assets/android-icon-background.png",
        monochromeImage: "./assets/android-icon-monochrome.png",
      },
      predictiveBackGestureEnabled: false,
      package: "com.anonymous.movomobile",
    },
    web: {
      favicon: "./assets/favicon.png",
      bundler: "metro",
    },
    plugins: [
      [
        "@didit-protocol/sdk-react-native",
        {
          iosNfcEnabled: false,
          androidNfcEnabled: false,
        },
      ],
      "expo-font",
      "expo-splash-screen",
      "expo-router",
      ...(PUSH_NOTIFICATIONS_ENABLED ? ["expo-notifications"] : []),
      // Config explícita acá (no `ios.config.googleMapsApiKey`/`android.config.googleMaps.apiKey`)
      // a propósito: ese mod genérico de Expo agrega el pod `react-native-google-maps` en
      // iOS, que ya no existe en `react-native-maps@1.27` (se renombró a un subspec,
      // `react-native-maps/Google`) — rompe `pod install` con "No podspec found". El
      // plugin propio del paquete sí conoce el nombre correcto para la versión instalada.
      [
        "react-native-maps",
        {
          iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_API_KEY ?? "",
          androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? "",
        },
      ],
      ...(PUSH_NOTIFICATIONS_ENABLED ? [] : [withoutPushEntitlement]),
    ],
    experiments: {
      typedRoutes: true,
    },
    // `eas init` (proyecto "movo-mobile", org "movosend") — necesario para que
    // `Notifications.getExpoPushTokenAsync({ projectId })` (MOVO-107) pueda pedir un
    // token real. Se había corrido en una rama anterior pero el valor nunca se
    // commiteó (vivía solo en un `app.json` local, reemplazado por este
    // `app.config.js` en MOVO-73) — se perdió al cambiar de rama.
    extra: {
      eas: {
        projectId: "077f9c8d-cb66-4772-a76c-34e4548290e7",
      },
    },
  },
};
