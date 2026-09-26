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
const {
  withEntitlementsPlist,
  withDangerousMod,
  withXcodeProject,
  IOSConfig,
} = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const PUSH_NOTIFICATIONS_ENABLED =
  process.env.ENABLE_PUSH_NOTIFICATIONS === "true";

const withoutPushEntitlement = (config) =>
  withEntitlementsPlist(config, (config) => {
    delete config.modResults["aps-environment"];
    return config;
  });

/**
 * MOVO-207 / iOS 18+: escribe SceneDelegate.swift en la carpeta ios/ y lo
 * agrega al proyecto Xcode durante el prebuild. Expo genera el Info.plist con
 * UIApplicationSceneManifest (declarado en ios.infoPlist abajo), pero el
 * SceneDelegate referenciado ahí debe existir como archivo fuente compilable.
 * Sin este plugin el error "UIScene life cycle is required" persiste.
 */
const SCENE_DELEGATE_SOURCE = `internal import Expo
import UIKit

// SceneDelegate requerido por iOS 18+ (UIScene lifecycle).
// IMPORTANTE: debe conformar UIWindowSceneDelegate directamente —
// ExpoAppDelegate implementa UIApplicationDelegate, no UISceneDelegate.
// En willConnectTo se reutiliza la UIWindow que AppDelegate ya creó vía
// ExpoReactNativeFactory, asignándola a la nueva UIWindowScene.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene,
          let existingWindow = (UIApplication.shared.delegate as? AppDelegate)?.window
    else { return }
    existingWindow.windowScene = windowScene
    self.window = existingWindow
  }
}
`;

const withSceneDelegate = (config) => {
  // Paso 1: escribir el archivo Swift en ios/<AppName>/SceneDelegate.swift
  config = withDangerousMod(config, [
    "ios",
    async (config) => {
      const appName = config.modRequest.projectName;
      const iosDir = path.join(config.modRequest.platformProjectRoot, appName);
      const filePath = path.join(iosDir, "SceneDelegate.swift");
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, SCENE_DELEGATE_SOURCE, "utf8");
      }
      return config;
    },
  ]);

  // Paso 2: agregar SceneDelegate.swift al proyecto Xcode (Sources build phase)
  config = withXcodeProject(config, (config) => {
    const project = config.modResults;
    const appName = config.modRequest.projectName;
    const fileName = "SceneDelegate.swift";

    // addBuildSourceFileToGroup resuelve el grupo por nombre (la API cruda de
    // `xcode` espera el UUID del grupo) y es idempotente si el archivo ya está.
    config.modResults = IOSConfig.XcodeUtils.addBuildSourceFileToGroup({
      filepath: `${appName}/${fileName}`,
      groupName: appName,
      project,
    });
    return config;
  });

  return config;
};

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
      // Identificador fijo real, siempre (MOVO-232) — antes variaba por developer
      // (`com.movosend.movomobile.$USER`, con un override `IOS_BUNDLE_ID` opcional)
      // para que cada uno tuviera su propio bundle id en local y no chocara
      // provisioning profiles con un Personal Team gratis de Apple. Con todo el
      // equipo firmando ahora contra el mismo Apple Developer Team pago (ver Xcode →
      // Signing & Capabilities en cada máquina, `eas credentials` ya generó el
      // certificado/provisioning profile de ese App ID), ese problema ya no existe —
      // y el equipo quiere justamente lo contrario, que todo build (local o EAS) sea
      // indistinguible. Sin override por env var a propósito: un `IOS_BUNDLE_ID`
      // suelto en el `.env.local` de alguien (leftover de antes de MOVO-232) volvería
      // a partir el bundle id en silencio.
      bundleIdentifier:
        process.env.EAS_BUILD_PROFILE === "production"
          ? "com.movosend.movomobile"
          : (process.env.IOS_BUNDLE_ID ?? "com.movosend.movomobile"),
      infoPlist: {
        // Solo HTTPS + firma ECDSA del handshake (ADR-020): cifrado estándar/exento.
        // Sin esto, cada build de TestFlight queda en "Missing Compliance" hasta que
        // alguien responda a mano la pregunta de exportación en App Store Connect.
        ITSAppUsesNonExemptEncryption: false,
        NSCameraUsageDescription:
          "Movo necesita la cámara para tomar tu foto de perfil, verificar tu identidad durante el registro y escanear el código de confirmación de retiro/entrega.",
        NSMicrophoneUsageDescription:
          "Movo necesita el micrófono para grabar el video de verificación de vida durante la verificación de identidad con Didit.",
        NSPhotoLibraryUsageDescription:
          "Movo necesita acceso a tus fotos para elegir tu foto de perfil y subir imágenes de tu documento.",
        NFCReaderUsageDescription:
          "Movo usa NFC para leer el chip de tu pasaporte durante la verificación de identidad con Didit.",
        NSLocationWhenInUseUsageDescription:
          "Movo usa tu ubicación para compartir el avance del envío en tiempo real con el emisor y receptor mientras transportás un paquete, y para ayudarte a marcar direcciones en el mapa.",
        NSLocationAlwaysAndWhenInUseUsageDescription:
          "Movo usa tu ubicación en segundo plano para compartir el avance del viaje en tiempo real con el emisor y receptor mientras transportás paquetes, incluso cuando la app está minimizada o la pantalla bloqueada.",
        UIBackgroundModes: ["location"],
        // Permite tráfico HTTP plano hacia direcciones de red local (RFC1918/.local) sin
        // afectar ATS para el resto de internet — necesario para probar un development
        // build en un iPhone físico contra el backend corriendo en la LAN (override desde
        // /dev-connection). Sin esto, iOS bloquea el fetch a http://192.168.x.x:... aunque
        // la app y el backend estén en la misma red.
        NSAppTransportSecurity: {
          NSAllowsLocalNetworking: true,
        },
        // iOS 18+ requiere el ciclo de vida UIScene para apps compiladas con el SDK
        // más reciente (error: "UIScene life cycle is required"). Se declara una sola
        // escena de ventana (ApplicationSupportsMultipleScenes=false) apuntando al
        // SceneDelegate.swift que delega a ExpoAppDelegate.
        UIApplicationSceneManifest: {
          UIApplicationSupportsMultipleScenes: false,
          UISceneConfigurations: {
            UIWindowSceneSessionRoleApplication: [
              {
                UISceneConfigurationName: "Default Configuration",
                UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
              },
            ],
          },
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
      // MOVO-232: reemplaza el placeholder de scaffold `com.anonymous.movomobile` —
      // identificador fijo real, mismo criterio que `ios.bundleIdentifier` de arriba
      // (no cambia por developer/build, Play no permite cambiarlo después del primer
      // release).
      package: "com.movosend.movomobile",
      // Requerido por la migración de Expo a FCM v1 para push notifications reales en
      // Android (independiente del ENABLE_PUSH_NOTIFICATIONS de iOS más arriba — FCM
      // no tiene el mismo problema de provisioning con team gratis, así que no está
      // gateado). Identifica la app ante Firebase (proyecto "movosend", package
      // com.movosend.movomobile) — sin este archivo, Android nunca recibe push, ni en
      // build de EAS ni en uno local (`expo run:android`). El JSON en sí no se trackea
      // en git (`.gitignore`, mismo criterio que los `.p8`/`.p12` de iOS) — cada
      // developer lo baja de Firebase Console y lo pega acá; en EAS Cloud se resuelve
      // vía el secret de archivo `GOOGLE_SERVICES_JSON` (ver eas.json).
      googleServicesFile: process.env.GOOGLE_SERVICES_JSON ?? "./google-services.json",
      permissions: [
        "ACCESS_FINE_LOCATION",
        "ACCESS_COARSE_LOCATION",
        "ACCESS_BACKGROUND_LOCATION",
      ],
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
      [
        "expo-image-picker",
        {
          photosPermission:
            "Movo necesita acceso a tus fotos para que puedas elegir tu foto de perfil.",
          cameraPermission:
            "Movo necesita acceso a tu cámara para que puedas tomarte una foto de perfil.",
        },
      ],
      [
        "expo-location",
        {
          locationWhenInUsePermission:
            "Movo usa tu ubicación para compartir el avance del envío en tiempo real con el emisor y receptor mientras transportás un paquete, y para ayudarte a marcar direcciones en el mapa.",
          locationAlwaysAndWhenInUsePermission:
            "Movo usa tu ubicación en segundo plano para compartir el avance del viaje en tiempo real con el emisor y receptor mientras transportás paquetes, incluso cuando la app está minimizada o la pantalla bloqueada.",
          isAndroidBackgroundLocationEnabled: true,
        },
      ],
      // Sin `cameraPermission` propio acá — el `NSCameraUsageDescription` ya cubre
      // este uso (arriba, `ios.infoPlist`), mismo criterio que MOVO-160 solo necesita
      // habilitar el escaneo de barcodes/QR, no pedir un permiso de cámara nuevo.
      [
        "expo-camera",
        {
          barcodeScannerEnabled: true,
        },
      ],
      "expo-font",
      // MOVO-247: sin imagen -- el splash nativo (estático, no puede animar) solo
      // tapa el hueco entre el arranque del proceso y el primer frame con fuentes
      // cargadas, momento en el que `AnimatedSplash` (JS, `app/_layout.tsx`) ya
      // puede tomar la posta con el isotipo real. El color de fondo por tema evita
      // el flash blanco-a-negro que Android muestra por default en dark mode antes
      // de ese handoff.
      [
        "expo-splash-screen",
        {
          backgroundColor: "#FFFFFF",
          dark: {
            backgroundColor: "#0A0A0B",
          },
        },
      ],
      "expo-router",
      "@react-native-community/datetimepicker",
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
          androidGoogleMapsApiKey:
            process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? "",
        },
      ],
      ...(PUSH_NOTIFICATIONS_ENABLED ? [] : [withoutPushEntitlement]),
      // iOS 18+: crea SceneDelegate.swift y lo registra en el proyecto Xcode
      withSceneDelegate,
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
