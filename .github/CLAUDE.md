# CLAUDE.md — .github

Workflows de CI/CD. Contexto general del proyecto en el `CLAUDE.md` de la raíz.

### CI/CD mobile: build en EAS al crear un tag (`.github/workflows/mobile-eas.yml`)

Primer workflow de build/submit de `movo-mobile` — hasta acá el CI/CD solo cubría
backend (`ci-dev.yml`/`ci-prod.yml`). Un tag de git dispara el build en EAS Cloud:

- **`dev-*`** (ej. `dev-2026-09-21`) → development build, profile `development`, iOS +
  Android.
- **`v*`** (ej. `v1.0.0`) → profile `staging` solo iOS con `--auto-submit` a
  TestFlight. Un guard previo falla el job si el commit taggeado no es ancestro de
  `origin/develop` ni de `origin/main` — no se publica a TestFlight un build de una
  rama feature sin mergear.

**TestFlight apunta a dev, no a prod**: la EC2 de producción está apagada por costos, así
que el profile `staging` de `eas.json` (`distribution: store`, `EXPO_PUBLIC_API_URL=
https://api-dev.movosend.app`, push activado) reemplaza al `production` para este flujo.
`staging` declara `environment: "production"` a propósito: las variables de EAS
(`GOOGLE_MAPS_IOS_API_KEY`) están cargadas en el ambiente `production`, y sin esa línea
el build no las tomaría. El profile `production` sigue intacto y sin ningún workflow que
lo use — cuando se prenda la EC2 de prod, sumar un tag propio (ej. `prod-*`) con un
guard contra `main`.

Decisiones no obvias: cada job **espera** a que EAS termine el build (sin `--no-wait`), así
el check de GitHub refleja el resultado real. Cuesta ~15-25 min de runner por build más la
cola de EAS, pero el repo es público (minutos gratis) — si pasara a privado, revisar esto.
El development build corre en una matriz `ios`/`android` (dos jobs en paralelo,
`fail-fast: false`). Workflow en Node 22, no 20 como el resto: `eas-cli` latest depende de
paquetes que exigen Node >= 22. El workflow que corre es el del
commit taggeado, así que tiene que estar mergeado antes de taggear. La versión de
marketing (`version` de `app.config.js`) NO se deriva del tag — el número de build lo
incrementa EAS (`autoIncrement`). El hook `eas-build-post-install` de `movo-mobile`
buildea `@movo/shared` en el servidor de EAS (ver `movo-mobile/HISTORIAL.md`).

**Aviso en Telegram** (`.github/scripts/notify-eas-build.sh`, secrets
`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` a nivel de repo, no de environment): al terminar
cada job avisa al chat del equipo si el build quedó listo o falló, con la plataforma
(iOS/Android) y el link a la página del build. Se hace desde el workflow y no con un
webhook de EAS porque Telegram no entiende el payload del webhook: haría falta una
función intermedia desplegada aparte. `if: always()` para avisar también los fallos;
`continue-on-error` y se omite sin secrets, así que un aviso que falla nunca cambia el
resultado del build. El link se saca del log de `eas build` con `grep` (no con `--json`,
para no depender de su formato). El script acepta `DRY_RUN=1` para probar el mensaje sin
enviarlo.

**Dispositivos iOS del development build**: el perfil ad hoc lleva la lista de UDIDs
adentro. Sumar un iPhone exige `eas device:create` y volver a correr a mano
`eas build -p ios --profile development` (login de Apple del titular, la cuenta es
Individual) para regenerar el perfil; recién el siguiente tag `dev-*` lo incluye. El CI,
al ser `--non-interactive`, no puede regenerarlo.

Estado: el build de `staging` y su submit a TestFlight se probaron a mano (la App Store
Connect API Key quedó guardada en EAS para el submit del CI; `ascAppId` fijo en
`eas.json#submit.staging.ios`); `expo-dev-client` se agregó a `movo-mobile` porque el
profile `development` lo necesita. El primer development build de Android se corrió a mano
(EAS no genera el keystore en modo `--non-interactive`). Un tag `dev-*` sobre la rama
encoló los builds y el aviso de Telegram llegó. Pendiente de verificar: la versión que
espera al build (matriz por plataforma), y un tag `v*` sobre `develop` (guard + TestFlight).
