# Capturas automáticas del Manual de Usuario

Cómo generar las 108 capturas del Manual de Usuario (Tomo III) contra el **backend real de dev** (`https://api-dev.movosend.app`) con cuentas de prueba de Movo. Los estados que son difíciles de alcanzar sin teléfonos reales (pago retenido, viaje en curso, entrega, sanciones) se **fuerzan en dev**, ver la regla 1. La lista de qué capturar (código, pantalla, estado) está en `docs/tomos/datos/capturas.yaml`; el build las toma solo de `docs/tomos/assets/capturas/M-NN.png` (móvil) y `W-NN.png` (panel).

> Esto se corre en una Mac. Está escrito para ejecutarlo con Claude Code local, que ve el simulador y el repo.

## Reglas

1. **Estados forzados en dev, código intacto:** la app y el panel apuntan a dev, sin `SUPPORT_MOCK` ni `MOVO_ADMIN_MOCK`. Un estado que no se puede alcanzar de forma natural en un simulador (hold de Mercado Pago, `in_transit`, `delivered`, suspensión de cuenta, mensajes del equipo de soporte) se arma escribiendo en la base de dev o con la API, siempre con envíos marcados «[manual]». Cualquier cambio de código para sortear una limitación del simulador (cámara que no existe, galería en lugar de cámara, un `metro.config.js` con un shim de `expo-camera`) **se revierte antes de commitear** (`git status` limpio en `movo-mobile`) y lo que se haya forzado se deshace al terminar (levantar sanciones, cerrar viajes). Se declara en el Manual cuando una captura es representativa y no del flujo real, por ejemplo el visor de la cámara.
2. **Credenciales fuera del repo.** Teléfono y contraseña van en variables de entorno de tu shell (`MOVO_TEST_PHONE`, `MOVO_TEST_PASSWORD`) o en un archivo `capturas/.env.capturas` (ignorado por Git). Nunca en los flujos ni en los commits.
3. **Datos de prueba reconocibles.** Las capturas muestran lo que haya en tu cuenta. Antes de capturar, revisá nombre, dirección y teléfono visibles; usá una cuenta con datos que puedan figurar en un documento impreso.
4. **Escribir en dev está permitido.** Los flujos pueden crear envíos, ofertas, pagos y cancelaciones reales. Para no ensuciar demasiado, usá un prefijo reconocible en las descripciones (por ejemplo «[manual]») y, si querés, cancelá lo que quede abierto al terminar.

## Requisitos

- Xcode con un simulador de iPhone (recomendado: iPhone 16 Pro o el modelo del marco que vayas a usar).
- El bundle id por defecto es `com.movosend.movomobile` (si compilaste con `IOS_BUNDLE_ID`, usá ese). Exportalo: `export MOVO_APP_ID=com.movosend.movomobile`.
- Development build de la app instalado en el simulador (`docs/mobile-development-build.md`) con `movo-mobile/.env.local` en `EXPO_PUBLIC_API_URL=https://api-dev.movosend.app`.
- [Maestro](https://maestro.mobile.dev) (`brew install mobile-dev-inc/tap/maestro`; ojo, `brew install maestro` instala otro programa que no tiene nada que ver), `python3` con `pillow` (`pip install pillow`).
- Un PNG de iPhone con **pantalla transparente** (o el bezel oficial de Apple Design Resources). Guardalo como `capturas/marco-iphone.png`.

## Orden recomendado

1. **Solo lectura:** onboarding, login, inicio, perfil, ajustes, pagos y direcciones (la mayoría de M-01 a M-16, M-68 a M-92).
2. **Creación:** wizard de envío completo, publicación, ofertas de la segunda cuenta, elección de oferta y pago con tarjeta de prueba.
3. **Estados intermedios, al final:** con los envíos creados en el paso anterior se avanza el ciclo (asignado, retiro, en camino, entrega, calificación, disputa, soporte) y se captura en cada estado. Hacen falta dos cuentas de prueba (emisor y transportista) y una tercera, o la misma, como receptor.
4. **Panel web:** al final o en paralelo, en Chrome.

## Flujo de trabajo

### 1. Preparar el simulador

```bash
./capturas/preparar-simulador.sh "iPhone 16 Pro"
```

Arranca el simulador, fija la barra de estado (9:41, batería llena, señal completa, sin operador), fuerza el tema claro y la ubicación en Córdoba capital (-31.4201, -64.1888).

### 2. Levantar la app

```bash
cd movo-mobile && npx expo start --dev-client
```

Abrí la app en el simulador. La sesión se inicia con el flujo `flujos/00-login.yaml` (usa `MOVO_TEST_PHONE` y `MOVO_TEST_PASSWORD`).

### 3. Capturar

```bash
export MOVO_TEST_PHONE=...        # sin el +54 si la app lo antepone
export MOVO_TEST_PASSWORD=...
maestro test capturas/flujos/00-login.yaml
./capturas/capturar.sh M-14       # captura la pantalla actual como assets/capturas/M-14.png
```

`capturar.sh CODIGO` hace `xcrun simctl io booted screenshot`, guarda el original y, si es móvil, actualiza la versión enmarcada. Para cada código de `datos/capturas.yaml`:

1. Llevá la app al estado que indica el campo `estado` (con un flujo de Maestro o a mano).
2. Corré `./capturas/capturar.sh <codigo>`.

Los selectores de Maestro usan los `testID` de la app (hay más de 600; por ejemplo `login-phone`, `login-password`, `login-primary-action`). Con `maestro studio` ves la jerarquía y los ids de cada pantalla.

Los flujos incluidos son un punto de partida: `00-login.yaml` (sesión) y `01-recorrido-tabs.yaml` (pestañas y pantallas de perfil que solo se leen). Se agregan más a medida que se avanza, uno por grupo de capturas.

### 4. Enmarcar

`capturar.sh` guarda el original **sin marco** en `assets/capturas/` y el Manual lo enmarca aparte, sin tocarlo. Para generar las versiones con marco de iPhone:

```bash
python3 capturas/enmarcar_todas.py            # solo las que cambiaron
python3 capturas/enmarcar_todas.py M-14 M-15  # códigos puntuales
python3 capturas/enmarcar_todas.py --forzar   # todas de nuevo
```

Salen en `assets/capturas-marco/M-NN.png` (1320x2718). Esa carpeta **no se commitea** (pesa unos 57 MB, ver `.gitignore`): se regenera con el comando de arriba. `herramientas/gen_manual_usuario.py` usa la enmarcada si existe y, si no, el original; las del panel (W-NN) no se enmarcan. Necesita Pillow (`/usr/bin/python3` de macOS ya lo trae).

`enmarcar.py` por sí solo no sirve con este marco: la isla dinámica está dibujada dentro del área transparente y la detección automática arranca debajo de ella, deformando la captura. `enmarcar_todas.py` ya le pasa el rectángulo real de la pantalla (`--pantalla 57,48,1206,2622 --radio 184`), que coincide con el tamaño exacto de una captura del simulador.

### 5. Ver el resultado en el PDF

```bash
python3 docs/tomos/build.py tomo-3
```

El marco de cada captura pasa de «Captura pendiente» a la imagen. La lista del apéndice marca el estado *Incluida*.

## Qué se puede automatizar y qué no

| Grupo | Capturas | Cómo |
|----------------|--------------|------------------------------------------------|
| Onboarding, login, recuperar contraseña | M-01 a M-03, M-13 | Maestro, sin sesión. El carrusel solo aparece en una instalación nueva (`xcrun simctl uninstall`). |
| Registro y KYC | M-04 a M-12 | **Manual o parcial.** El registro crea una cuenta nueva (usá un teléfono de prueba extra) y el KYC real de Didit necesita la cámara, que el simulador no tiene. Para los resultados de KYC (M-11, M-12) se usan cuentas de prueba que ya estén en cada estado. |
| Inicio, Mis envíos, perfiles, ajustes | M-14 a M-16, M-25, M-26, M-68 a M-72, M-80 a M-92 | Maestro, solo lectura. Es lo más fácil. |
| Wizard de envío | M-17 a M-24 | Maestro hasta el resumen, sin confirmar. Las fotos (M-22) necesitan imagen: el simulador permite agregar fotos a la galería con `xcrun simctl addmedia booted foto.jpg`. |
| Ofertas, pago, tarjeta | M-31 a M-37, M-51 a M-54, M-74 a M-79 | Requieren un envío en el estado adecuado: se crea con las cuentas de prueba (emisor y transportista) y se avanza en el orden del paso 3. Las tarjetas de prueba de Mercado Pago están en `docs/payments/mercadopago-spike/README.md`. |
| Retiro, entrega, QR, escaneo | M-38, M-46, M-60 a M-66 | **Manual o parcial.** El escaneo necesita la cámara y la proximidad de 100 m. En el simulador, `xcrun simctl location booted set LAT,LNG` fija la posición del transportista; el QR del emisor se captura en una pantalla y no se escanea. |
| Seguimiento y ruta | M-39, M-59 | Necesita un envío en camino con posición reportada. El mapa usa la clave de Google Maps del build; si sale gris, la clave del build no está cargada o no autoriza el bundle id (ver `app.config.js`). |
| Chat y soporte | M-40, M-41, M-88 a M-90 | Maestro, con un envío asignado y una consulta existente. |
| Push | M-93 | `xcrun simctl push booted <bundle-id> push.json` con un JSON de ejemplo. |
| Panel web | W-01 a W-18 | Claude in Chrome (ver abajo). |

## Panel de administración (W-01 a W-18)

1. Abrí `https://admin-dev.movosend.app` (`admin.movosend.app` es el de prod y en dev da 404; o el panel local apuntando a dev) en Chrome con una ventana de **1440 x 900**.
2. Ingresá con tu cuenta de administrador (contraseña y código por correo; el código lo ingresás vos).
3. Pedile a Claude in Chrome que recorra las rutas de `datos/capturas.yaml` con código `W-NN` y guarde cada captura de ventana como `assets/capturas/W-NN.png`.
4. Antes de capturar, verificá que no se vean datos personales reales de otros usuarios: en la ficha, la búsqueda y la bandeja de soporte aparecen datos de personas. Usá cuentas de prueba o difuminá esas zonas.
5. Sanciones (MOVO-299) y la bandeja de soporte real (MOVO-322) ya están en dev. W-02 (código de seis dígitos) la saca la persona: `/verify` redirige al login si no hay un ingreso en curso, así que hay que ingresar email y contraseña a mano y capturar antes de escribir el código. W-16 a W-18 son extras (diálogo de suspender, KYC y vehículo, menú de la cuenta); los diálogos de escritura se abren, se capturan y se cancelan sin confirmar.

## Capturas representativas (no del flujo real)

- **M-46:** el simulador no tiene cámara; el visor de «Confirmar entrega» se ve en gris (shim de `expo-camera`) y el título se fuerza a «Confirmar entrega». Representa la pantalla del receptor.
- **M-64:** la confirmación del escaneo se simuló en la app (sin escanear el QR ni cambiar el estado del envío en dev). La pantalla y sus textos son los reales.
- **M-76:** se abrió el navegador de Mercado Pago desde «Cambiar cuenta» y se cerró sin completar la autorización, así que la cuenta vinculada no cambió.
- **M-93:** push enviada con `xcrun simctl push` sobre la pantalla de bloqueo. Se ve asomar una notificación de otra app del simulador y el badge «11» del ícono; si se quiere una captura más limpia, repetirla en un simulador nuevo.
- **Build de la app:** el development build tiene que compilarse con el código del worktree (`npx expo run:ios` desde `movo-mobile`); una compilación vieja falla con «Cannot find native module» al recargar el bundle.

## Control de calidad

- Recorré `assets/capturas/` y confirmá en cada imagen que no haya datos personales ajenos, claves ni tokens.
- Revisá que el texto del marco coincida con lo que describe el manual (si la app cambió, ajustá `datos/capturas.yaml` y el manual).
- Las capturas se commitean en `docs/tomos/assets/capturas/`. Cada PNG pesa poco; si el repositorio crece demasiado, mover a un almacenamiento aparte.
