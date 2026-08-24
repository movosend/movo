# Development build de `movo-mobile`

Cómo correr la app en un simulador o en un teléfono físico. Escrito para macOS, que es
lo que usa la mayoría del equipo (para Android la parte de Xcode no aplica, el resto sí).

## Por qué no alcanza con Expo Go

La app usa dos módulos nativos que Expo Go no trae compilados:

- `@didit-protocol/sdk-react-native` — verificación de identidad (MOVO-72).
- `react-native-maps` — el paso de mapa del wizard de registro (MOVO-73).

En Expo Go la app arranca igual (el import del SDK de Didit es diferido a propósito),
pero tocar "Empezar verificación" o entrar al paso de mapa no funciona. Para probar esos
flujos hace falta un **development build**: un build nativo propio, en modo debug, que
carga el JS desde Metro igual que Expo Go.

## Qué tenés que tener instalado

| | Para qué |
|---|---|
| Node 20 | Todo |
| Xcode + Command Line Tools | Builds de iOS (simulador y dispositivo) |
| CocoaPods (`sudo gem install cocoapods` o `brew install cocoapods`) | Dependencias nativas de iOS |
| Cuenta de Apple (gratuita alcanza) | Firmar el build para un iPhone físico |
| Android Studio + un SDK/emulador | Solo si vas a buildear Android |

Y en el repo:

```bash
npm install                       # desde la RAÍZ del monorepo — movo-mobile es un workspace
cd movo-mobile
cp .env.example .env.local        # gitignored; completá EXPO_PUBLIC_API_URL
```

Las keys de Google Maps (`GOOGLE_MAPS_IOS_API_KEY` / `GOOGLE_MAPS_ANDROID_API_KEY`)
todavía no están generadas por el equipo. Sin ellas el build funciona, pero el mapa
renderiza en gris (no rompe nada más). Ver los comentarios de `.env.example`.

## `prebuild`: generar las carpetas nativas

```bash
npx expo prebuild            # genera ios/ y android/ desde app.config.js
npx expo prebuild --clean    # las borra y regenera de cero
```

`ios/` y `android/` están **gitignored**: son artefactos generados, nadie los commitea.

**Cuándo correrlo:**

- La primera vez que clonás el repo.
- Cuando cambia `app.config.js` (plugins, permisos, bundle id, keys de Maps).
- Cuando se agrega o actualiza una dependencia con código nativo.

**Usá `--clean`** siempre que cambies plugins o keys en `app.config.js`. Sin eso, el
prebuild incremental puede dejar el `Info.plist` / `AndroidManifest.xml` viejo y vas a
debuggear un síntoma que no existe. Si tenés cambios a mano dentro de `ios/` o
`android/`, `--clean` se los lleva puestos (no deberías tenerlos: todo va por config
plugin).

No hace falta correrlo explícitamente antes de `run:ios` / `run:android` — esos comandos
lo disparan solos si las carpetas no existen. Se corre a mano cuando querés forzar la
regeneración.

## `run:ios` / `run:android`: compilar e instalar

```bash
npx expo run:ios                 # simulador de iOS (el default de Xcode)
npx expo run:ios --device        # elegí de una lista: iPhone físico conectado por USB
npx expo run:android             # emulador de Android
npx expo run:android --device    # teléfono Android físico (con depuración USB activada)
```

**Cuándo usás cada uno:**

- **Simulador (sin `--device`)** — el default para el día a día. Compila más rápido, no
  necesita firma ni cable. No sirve para cámara real, NFC, ni para probar el mapa con
  GPS de verdad.
- **`--device` (teléfono físico)** — obligatorio para el flujo de KYC de Didit (cámara +
  liveness), y para lo que vale la pena mirar el mapa. Es también lo que pide la DoD de
  MOVO-73.

La primera compilación tarda varios minutos (compila todos los Pods). Las siguientes son
incrementales y mucho más rápidas.

### Primera vez en un iPhone físico

1. Conectá el iPhone por USB y desbloqueálo ("Confiar en esta computadora").
2. Activá **Ajustes → Privacidad y seguridad → Modo de desarrollador** (iOS 16+) y
   reiniciá el teléfono.
3. Xcode va a pedir un equipo de firma. Abrí `movo-mobile/ios/Movo.xcworkspace` una vez,
   seleccioná tu Apple ID en *Signing & Capabilities → Team*, y cerrá. Con una cuenta
   gratuita el certificado dura 7 días: después de eso hay que volver a instalar.
4. Después de instalar, si iOS se queja de un desarrollador no confiable:
   **Ajustes → General → VPN y gestión de dispositivos → Confiar**.

## Después del primer build

El binario ya quedó instalado en el dispositivo. Para el día a día solo necesitás Metro:

```bash
npx expo start
```

Y abrís la app **Movo** desde el teléfono/simulador (no desde Expo Go). El JS se recarga
al guardar; solo hay que volver a correr `run:ios`/`run:android` cuando toques código
nativo, dependencias nativas o `app.config.js`.

> `expo-dev-client` **no** está instalado en el proyecto, así que la app no tiene el menú
> de dev launcher para cambiar de URL de Metro. Si estás en un dispositivo físico,
> asegurate de que el teléfono y la Mac estén en la misma red Wi-Fi.

## Apuntar la app al backend

`EXPO_PUBLIC_API_URL` (en `.env.local`) queda embebida en el bundle en build time. Para
cambiar de backend sin rebuildear, en builds de desarrollo hay una pantalla de override:
navegá a la ruta **`/dev-connection`** dentro de la app y pegá la URL (por ejemplo
`http://192.168.0.42:3000` si estás corriendo el gateway en tu Mac — usá la IP de LAN, no
`localhost`, que en el teléfono apunta al teléfono).

El override se ignora en builds de producción por diseño. Para levantar el backend en
local ver [`backend-local-docker.md`](./backend-local-docker.md).

## Problemas comunes

| Síntoma | Qué probar |
|---|---|
| `pod install` falla con "No podspec found" | `npx expo prebuild --clean` y volver a buildear |
| Cambiaste `app.config.js` y no se ve el cambio | Faltó `--clean` en el prebuild |
| La app en el teléfono no encuentra Metro | Misma Wi-Fi que la Mac; probá `npx expo start --tunnel` |
| El mapa se ve gris | Faltan las keys de Google Maps en `.env.local` (esperado hoy) |
| La app instalada dejó de abrir a la semana | Certificado gratuito vencido: volvé a correr `run:ios --device` |
| Errores raros de build de iOS | `rm -rf ios && npx expo prebuild --clean` |

`eas build` (builds en la nube) todavía no está disponible: falta correr `eas init` con
la cuenta del equipo. Los perfiles ya están escritos en `eas.json`.
