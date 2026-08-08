# Levantar el backend en local con Docker

Todo el server-side (Postgres, Redis, gateway, los 5 microservicios y el proxy nginx)
corre con Docker Compose, buildeado desde el código fuente. `movo-mobile` y `movo-admin`
no están dockerizados.

## Setup inicial (una sola vez)

Necesitás Docker Desktop (o Docker Engine + el plugin de Compose) corriendo.

```bash
cd infra
cp .env.example .env      # los defaults ya sirven para local
./local-certs.sh          # cert self-signed para el proxy nginx
```

`infra/.env` es el que lee Compose para inyectarle `DATABASE_URL`, `JWT_SECRET`, etc. a
los contenedores. Nunca se commitea. Los defaults dejan las integraciones externas en
modo simulado: `SMS_PROVIDER=console` (el OTP se loguea), `DIDIT_MODE=mock` y
`GEOCODING_PROVIDER=mock` (sin red ni API keys).

## Levantar todo

Los dos `-f` son obligatorios siempre: el base define los servicios, el `.local` los
buildea desde el código en vez de pullear de GHCR y publica los puertos.

```bash
cd infra
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

Conviene dejarte un alias en el `.zshrc` para no repetirlo:

```bash
alias movoc='docker compose -f ~/ruta/al/repo/infra/docker-compose.yml -f ~/ruta/al/repo/infra/docker-compose.local.yml'
```

Solo los servicios de app, sin el proxy nginx (más rápido para iterar):

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build \
  postgres redis gateway movo-svc-users
```

## Aplicar las migraciones

**Compose no corre migraciones solo.** Con la base recién creada las tablas no existen y
los servicios responden errores de SQL.

`movo-svc-users` usa Prisma (ADR-011); el resto sigue con SQL plano vía script:

```bash
# svc-users (Prisma) — la CLI viaja en la imagen, se corre adentro del contenedor
docker compose -f docker-compose.yml -f docker-compose.local.yml \
  run --rm movo-svc-users npx prisma migrate deploy

# el resto de los servicios (SQL plano), desde la raíz del repo
DATABASE_URL=postgresql://movo:movo_local_pw@localhost:5432/movo \
  ./scripts/run-migrations.sh services/movo-svc-shipments
```

Ambos comandos son idempotentes: si ya está todo aplicado, no hacen nada.

Si estás iterando sobre `movo-svc-users` nativo (`npm run dev`), desde
`services/movo-svc-users` alcanza con `npm run migrate` (usa el `DATABASE_URL` de tu
`.env`, que tiene que apuntar a `localhost:5432`, no a `postgres:5432`).

## Puertos

| | URL |
|---|---|
| Proxy nginx (TLS self-signed) | `https://localhost/` — usá `curl -k` |
| Gateway | `http://localhost:3000` |
| `movo-svc-users` | `http://localhost:3001` |
| `movo-svc-shipments` | `http://localhost:3002` |
| `movo-svc-payments` | `http://localhost:3003` |
| `movo-svc-admin` | `http://localhost:3004` |
| `movo-svc-pricing-logistics` | `http://localhost:3005` |
| Postgres | `localhost:5432` (`movo` / `movo_local_pw`) |
| Redis | `localhost:6379` |

Los puertos directos de cada servicio son para debuggear sin pasar por el gateway. El
tráfico real de la app entra por el gateway (`/api/v1/...`).

Chequeo rápido de que todo levantó:

```bash
curl -k https://localhost/health     # proxy → gateway
curl http://localhost:3001/health    # svc-users: estado de Postgres y Redis
```

## Trabajar con un solo servicio

```bash
# reiniciar sin rebuildear (sirve si solo cambió una env var de infra/.env)
docker compose -f docker-compose.yml -f docker-compose.local.yml restart movo-svc-users

# rebuildear y recrear después de tocar código
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build movo-svc-users

# logs en vivo
docker compose -f docker-compose.yml -f docker-compose.local.yml logs -f movo-svc-users

# shell adentro del contenedor
docker compose -f docker-compose.yml -f docker-compose.local.yml exec movo-svc-users sh
```

`restart` **no** recompila nada: reusa la imagen que ya está construida. Si cambiaste
código TypeScript, necesitás `up -d --build`.

Para desarrollo activo de un servicio conviene no dockerizarlo: levantá solo
`postgres redis` con Compose y corré el servicio nativo con `npm run dev` (hot-reload),
con el `.env` apuntando a `localhost`. Detalle en la sección 3 del `README.md`.

### Ver el OTP en local

Con `SMS_PROVIDER=console` no se manda ningún SMS: el código sale por los logs.

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml logs -f movo-svc-users | grep -i otp
```

## Bajar y resetear

```bash
# bajar todo, conservando la base
docker compose -f docker-compose.yml -f docker-compose.local.yml down

# bajar y BORRAR el volumen de Postgres (empezás de cero)
docker compose -f docker-compose.yml -f docker-compose.local.yml down -v
```

Después de un `down -v` hay que volver a aplicar las migraciones.

Si el disco se llena de imágenes viejas: `docker image prune -af` (sin `--volumes`, que
se llevaría la base).

## Conectar el mobile a este backend

Desde un teléfono físico, `localhost` apunta al teléfono. Usá la IP de LAN de tu Mac
(`ipconfig getifaddr en0`) y seteá `http://<tu-ip>:3000` desde la pantalla
`/dev-connection` de la app. Ver
[`mobile-development-build.md`](./mobile-development-build.md).

El proxy nginx en `https://` no sirve para esto: el certificado es self-signed y el
teléfono lo rechaza. Pegale directo al gateway por HTTP en el `:3000`.

## Problemas comunes

| Síntoma | Qué probar |
|---|---|
| El servicio se cae al arrancar por una env var | Una var *presente pero vacía* no matchea el enum del schema. Chequeá que `infra/.env` exista y esté completo |
| Errores de tabla o columna inexistente | Faltan las migraciones (ver arriba) |
| `port is already allocated` | Tenés un Postgres/Redis local corriendo fuera de Docker; paralo o cambiá el puerto en `docker-compose.local.yml` |
| Cambiaste código y no se ve | `restart` no rebuildea: usá `up -d --build <servicio>` |
| El navegador se queja del certificado | Esperado, es self-signed: `curl -k` o aceptá la excepción |
