# Propósito y Alcance

Este manual explica cómo **instalar, desplegar y operar** la plataforma Movo: el entorno local de desarrollo, los ambientes desplegados en AWS (desarrollo y producción), los frontends (panel web y aplicación móvil) y las tareas habituales de operación y diagnóstico. Está dirigido a quien despliega y mantiene la plataforma, con conocimientos de administración de Linux, Docker y bases de datos.

La arquitectura que se instala se describe en el Tomo II (documento de Arquitectura del Sistema); los procedimientos de negocio y de administración del panel, en el Manual de Procedimientos de este tomo.

# Requisitos

## Cuentas y servicios externos

| Servicio | Para qué se necesita | ¿Obligatorio? |
|--------------------|------------------------------------------------------|--------------------|
| AWS | Instancias EC2, bucket S3 de imágenes, Secrets Manager y roles de IAM | Sí, para los ambientes desplegados |
| GitHub y GHCR | Repositorio, Actions (CI/CD) y registro de imágenes Docker | Sí |
| Cloudflare | DNS del dominio (modo DNS-only) | Sí, para los ambientes desplegados |
| Vercel | Hosting del panel de administración | Sí, para el panel |
| Expo (EAS) | Builds de la aplicación móvil | Sí, para distribuir la aplicación |
| Mercado Pago | Aplicación Marketplace (OAuth, pagos y webhooks) | Para cobros reales |
| Didit.me | Verificación de identidad y de licencia | Para verificación real |
| Twilio | SMS con el código de verificación | Para SMS reales |
| Resend | Correo electrónico con el dominio de envío verificado | Para correos reales |
| Google Cloud | Claves de Maps (Routes, Geocoding, Places) | Para mapas y rutas reales |

: Cuentas y servicios externos.

En desarrollo y en las pruebas las integraciones externas se simulan (`SMS_PROVIDER=console`, `DIDIT_MODE=mock`, `GEOCODING_PROVIDER=mock`, `STORAGE_PROVIDER=mock`, entre otras), por lo que **no se necesita ninguna cuenta externa** para levantar y probar el sistema localmente.

## Software

| Componente | Versión |
|----------------|-----------------------------------------------|
| Docker Engine y plugin Compose | Versión reciente (Compose v2) |
| Node.js | 20 (para trabajar fuera de contenedores) |
| Python | 3.12 (servicio de precios, fuera de contenedores) |
| Git | Cualquier versión reciente |
| PostgreSQL y Redis | 16 y 7 (se levantan con Compose) |

: Software requerido.

## Hardware

Para el entorno local alcanza una computadora con 8 GB de RAM y varios GB de disco libres para las imágenes. Los ambientes desplegados usan una instancia EC2 por ambiente, con el disco dimensionado para las imágenes y el volumen de PostgreSQL (el tamaño exacto lo define el repositorio de infraestructura `movo-infra`).

# Instalación del Entorno Local

Todo el backend (PostgreSQL, Redis, el gateway, los cinco servicios y el proxy Nginx) corre con Docker Compose, construido desde el código fuente. La aplicación móvil y el panel web no están dockerizados.

## Pasos

1. **Obtener el código** y ubicarse en la carpeta `infra`.
2. **Crear el archivo de entorno:** copiar `.env.example` a `.env`. Los valores por defecto ya sirven para local y dejan las integraciones externas en modo simulado.
3. **Generar el certificado local** para el proxy: ejecutar `./local-certs.sh` (certificado autofirmado).
4. **Levantar todo.** Los dos archivos de Compose son obligatorios: el base define los servicios y el `.local` los construye desde el código y publica los puertos.

```
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

5. **Aplicar las migraciones.** Compose no las corre solo: con la base recién creada las tablas no existen. Para cada servicio con base de datos (`movo-svc-users`, `movo-svc-shipments`, `movo-svc-payments` y `movo-svc-admin`):

```
docker compose -f docker-compose.yml -f docker-compose.local.yml \
  run --rm movo-svc-users npx prisma migrate deploy
```

El comando es idempotente: si ya está todo aplicado, no hace nada.

6. **Verificar.** `curl -k https://localhost/health` (a través del proxy) responde `{"status":"ok"}`, y `http://localhost:3001/health` informa el estado de PostgreSQL y Redis del servicio de usuarios.

## Puertos del entorno local

| Componente | Dirección |
|--------------------|-----------------------------------------|
| Proxy Nginx (TLS autofirmado) | `https://localhost/` (usar `curl -k`) |
| API Gateway | `http://localhost:3000` |
| `movo-svc-users` | `http://localhost:3001` |
| `movo-svc-shipments` | `http://localhost:3002` |
| `movo-svc-payments` | `http://localhost:3003` |
| `movo-svc-admin` | `http://localhost:3004` |
| `movo-svc-pricing-logistics` | `http://localhost:3005` |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |

: Puertos del entorno local.

La documentación interactiva de la API (Swagger) se genera automáticamente y está disponible en la ruta `/docs` del gateway y de cada servicio de Node (por ejemplo, `http://localhost:3000/docs`).

## Operación local

- **Ver el código OTP.** Con `SMS_PROVIDER=console` no se envía ningún SMS: el código sale por el registro del servicio de usuarios.
- **Reiniciar un servicio.** `restart` reutiliza la imagen existente; si se cambió código, hay que reconstruirlo con `up -d --build <servicio>`.
- **Empezar de cero.** `down -v` borra el volumen de PostgreSQL; después hay que volver a aplicar las migraciones.
- **Desarrollo activo.** Conviene levantar solo `postgres` y `redis` con Compose y correr el servicio con `npm run dev` (recarga automática), con el `.env` del servicio apuntando a `localhost`.

## Ejecutar las pruebas

Cada paquete tiene su propio comando de pruebas (`npm test`, dentro del directorio del servicio o de la aplicación; `pytest` en el servicio de precios). Las pruebas de integración usan PostgreSQL y Redis reales, por lo que deben estar levantados, con las variables `DATABASE_URL`, `REDIS_URL` y `JWT_SECRET` definidas. El detalle está en el Plan de Testing (Tomo I).

# Instalación en AWS (Desarrollo y Producción)

Cada ambiente es una instancia EC2 con Docker Compose, en la región `sa-east-1`. La infraestructura se aprovisiona con Terraform en el repositorio separado `movo-infra` (ADR-009); este manual cubre solo lo que hay que hacer sobre esa infraestructura.

## Infraestructura previa (Terraform)

El repositorio `movo-infra` define, por ambiente: la instancia EC2 con su dirección IP elástica y su rol de IAM (acceso al bucket de imágenes), el bucket de imágenes, el secreto de AWS Secrets Manager y los registros DNS en Cloudflare. La instancia se inicializa con Docker y con Certbot en el sistema anfitrión (los certificados de Let's Encrypt se montan en el contenedor de Nginx).

## Secretos del ambiente

Los secretos de la aplicación viven en un único secreto de Secrets Manager por ambiente (`movo/dev/app-secrets` y `movo/prod/app-secrets`), con formato JSON clave-valor. En cada despliegue, el *workflow* lo vuelca a un archivo `.env`, y Docker Compose lo usa para inyectar variables a los contenedores. Las variables mínimas son:

- **Base de datos y sesión:** `POSTGRES_USER`, `POSTGRES_PASSWORD`, `DATABASE_URL`, `JWT_SECRET`.
- **Dominio:** `API_DOMAIN` (nombre del host del ambiente, por ejemplo `api-dev.movosend.app`).
- **Integraciones reales** (solo si se activan): `SMS_PROVIDER` y credenciales de Twilio; `EMAIL_PROVIDER`, `RESEND_API_KEY` y `EMAIL_FROM`; `DIDIT_MODE=live` y las credenciales de Didit; `GEOCODING_PROVIDER`, `ROUTES_PROVIDER` y `GOOGLE_MAPS_API_KEY`; `STORAGE_PROVIDER=s3`, `S3_BUCKET_NAME` y `S3_REGION`; las credenciales de la aplicación de Mercado Pago (`MP_CLIENT_ID`, `MP_CLIENT_SECRET`, `MP_REDIRECT_URI`, `MP_WEBHOOK_SECRET`, `MP_PUBLIC_KEY`).

El apéndice de este manual lista todas las variables de cada servicio.

::: importante
**Regla de las tres ubicaciones.** Una variable de entorno nueva debe agregarse en tres lugares en el mismo cambio: el `.env.example` del servicio, el esquema de validación `src/config/env.ts` y el bloque `environment:` del servicio en `infra/docker-compose.yml`. Compose solo inyecta a un contenedor las variables que están listadas allí; si falta la tercera, el despliegue sale verde y el servicio arranca sano pero **silenciosamente con el valor por defecto** (por ejemplo, el proveedor *mock*). Para las variables que eligen una implementación (`*_PROVIDER`, `DIDIT_MODE`) se usa la forma `${VAR:-default}`, porque una variable presente pero vacía no cumple el enumerado y tira el servicio abajo al arrancar.
:::

## DNS y certificados

1. En Cloudflare, el registro del host del ambiente apunta a la IP elástica de la instancia, en modo **DNS-only** (sin proxy), porque Nginx termina TLS en la propia instancia.
2. Los certificados de Let's Encrypt los emite y renueva Certbot en el sistema anfitrión; el contenedor de Nginx los lee de `/etc/letsencrypt`. El puerto 80 queda abierto para el desafío de validación.

## Primer despliegue

El despliegue es automático al integrar cambios (ver la sección siguiente). Para un ambiente nuevo:

1. Cargar el secreto de Secrets Manager con las variables del ambiente.
2. Cargar en GitHub (entorno `development` o `production`) los secretos del *workflow*: credenciales de AWS, usuario y clave SSH de la instancia y el token de acceso a GHCR.
3. Disparar el *workflow* manualmente (`workflow_dispatch`) o integrar un cambio en la rama correspondiente.
4. Verificar con `curl https://<API_DOMAIN>/health`.

# Despliegue Continuo

| Rama | Ambiente | Workflow | Etiqueta de imágenes |
|----------|--------------|----------------|------------------|
| `develop` | Desarrollo (`api-dev.movosend.app`) | `ci-dev.yml` | `dev` |
| `main` | Producción | `ci-prod.yml` | `prod` |

: Despliegue por rama.

El *workflow* de desarrollo ejecuta, en orden:

1. **Detección de cambios** por ruta, para construir solo los servicios afectados (un cambio en `shared/` los afecta a todos).
2. **Pruebas y construcción** de cada servicio: instalación, *lint*, verificación de tipos, migraciones sobre una base de prueba, pruebas, y construcción y publicación de la imagen en GHCR.
3. **Generación del `.env`** desde Secrets Manager. La contraseña de `DATABASE_URL` se reescribe con los caracteres reservados codificados (*percent-encoding*), porque el analizador de Prisma, a diferencia del de `pg`, falla con contraseñas que contienen `@`, `/` o `#` sin codificar.
4. **Copia a la instancia** (por SCP) del archivo de Compose, las plantillas de Nginx y el `.env`.
5. **Migraciones:** se levanta PostgreSQL, se hace `pull` explícito de las imágenes (necesario porque `run` no vuelve a descargar una imagen ya presente) y se ejecuta `prisma migrate deploy` en cada servicio, con un tiempo máximo de 10 minutos por servicio.
6. **Reinicio:** `docker compose pull` y `up -d --remove-orphans`, y reinicio del proxy.
7. **Limpieza:** `docker image prune -af` y reporte de espacio en disco, para evitar que el disco reducido de la instancia se llene de imágenes huérfanas.

Producción sigue el mismo flujo con sus propios secretos y su propia instancia.

## Marcha atrás

Las imágenes se etiquetan solo con el nombre del ambiente (`dev` o `prod`), sin versiones inmutables. Por eso **no hay un comando de *rollback* de imagen**: la forma de volver atrás es revertir el cambio en la rama (`git revert`) e integrar la reversión, lo que dispara un nuevo despliegue. Las migraciones de Prisma son incrementales; una migración ya aplicada no se deshace sola, por lo que los cambios de esquema deben ser compatibles hacia atrás.

# Despliegue de los Frontends

## Panel de administración

El panel (`movo-admin`) es una aplicación Next.js desplegada en Vercel. Para instalarlo:

1. Importar el repositorio en Vercel, con el directorio raíz `movo-admin`.
2. Definir en Vercel, por ambiente, la variable `MOVO_GATEWAY_URL` con la URL base del gateway del ambiente correspondiente (por ejemplo, `https://api-dev.movosend.app`). Es una variable exclusiva del servidor: la autenticación nunca usa variables `NEXT_PUBLIC_`. Además hay que definir `MOVO_APP_ORIGIN` (el origen exacto del panel, por ejemplo `https://admin.movosend.app`) y `MOVO_SESSION_SECRET` (secreto de sesión, generado con `openssl rand -hex 32` y estable entre las instancias del ambiente). La variable opcional `NEXT_PUBLIC_ESRI_API_KEY` es la clave pública, restringida por *referrer*, de ArcGIS Location Platform que usa el mapa de seguimiento del panel; sin ella el mapa se dibuja sin teselas.
3. Asignar el dominio del panel (`admin.movosend.app`) en Vercel y en Cloudflare.

## Aplicación móvil

La aplicación (`movo-mobile`) es React Native con Expo y se compila con EAS (Expo Application Services):

- Los identificadores de las tiendas están fijos (`android.package` e `ios.bundleIdentifier`) en `app.config.js`.
- El *workflow* `mobile-eas.yml` genera automáticamente los *builds* de desarrollo al crear una etiqueta (*tag*) del repositorio, y los distribuye a TestFlight para iOS.
- Las claves de Google Maps de la aplicación (iOS y Android) y la URL de la API se configuran por perfil de `eas.json`.
- Para probar en un dispositivo se usa un *development build*; el detalle de generación está en `docs/mobile-development-build.md` del repositorio.

# Operación

## Comandos habituales

Todos desde el directorio de despliegue de la instancia (`~/movo`), con el archivo `.env` presente:

| Tarea | Comando |
|----------------------------------|------------------------------------------------|
| Estado de los contenedores | `docker compose ps` |
| Registro en vivo de un servicio | `docker compose logs -f <servicio>` |
| Reiniciar un servicio | `docker compose restart <servicio>` |
| Actualizar imágenes y recrear | `docker compose pull && docker compose up -d --remove-orphans` |
| Aplicar migraciones de un servicio | `docker compose run --rm -T <servicio> npx prisma migrate deploy` |
| Espacio en disco | `df -h /` y `docker system df` |
| Limpiar imágenes huérfanas | `docker image prune -af` |
| Conectar a PostgreSQL | `docker compose exec postgres psql -U movo` |

: Comandos de operación.

## Alta del primer administrador

Una vez que existe la cuenta (registrada desde la aplicación, con el correo verificado y activa), se otorga el rol con el script del servicio de usuarios:

```
docker compose pull movo-svc-users && \
  docker compose run --rm -T movo-svc-users npm run admin:grant -- persona@movo.app
```

El script es idempotente y responde con un código de salida 0 si tiene éxito, 1 ante un error de configuración o de negocio (por ejemplo, correo sin verificar) y 2 ante un error de uso. Para revocar: `npm run admin:revoke`. A partir de ahí, los administradores se gestionan desde el panel.

## Tareas automáticas (barridos)

Los servicios ejecutan tareas periódicas en segundo plano, cada una con un candado en Redis para que corra en una sola réplica. Se pueden desactivar individualmente con su variable `*_SWEEP_ENABLED`, y su intervalo se ajusta con `*_SWEEP_INTERVAL_MINUTES`.

| Barrido | Servicio | Qué hace | Intervalo por defecto |
|--------------------------------|------------|----------------------------------------------------|----------|
| Confirmación del receptor | shipments | Cancela los envíos que el receptor no confirmó a tiempo | 15 min |
| Vencimiento de retiro | shipments | Cancela envíos publicados sin transportista a tiempo | 15 min |
| Retiro no realizado | shipments | Atribuye y cierra los envíos asignados cuyo retiro no ocurrió | 15 min |
| Pago de asignaciones | shipments | Revierte los pagos vencidos y avisa de las ventanas de pago | 5 min |
| Liquidaciones | shipments | Cierra los envíos entregados con cobro acreditado | 5 min |
| Tránsito demorado | shipments | Marca, avisa y abre disputa en envíos en tránsito demorados | 15 min |
| Vencimiento y recurrencia de viajes | shipments | Vence viajes y genera la siguiente ocurrencia | 15 min |
| Recordatorio de salida | shipments | Avisa antes de la salida de un viaje | 15 min |
| Fotos huérfanas | users, shipments | Elimina fotos subidas que nunca se confirmaron | 60 min |
| Traza de posición | shipments | Purga las posiciones más viejas que la retención | 60 min |
| Historial de envíos | shipments | Purga los envíos cerrados hace más de 5 años | 1.440 min |
| Sanciones | users | Levanta las suspensiones vencidas | 5 min |
| Verificaciones abandonadas | users | Purga verificaciones sin resultado | 1.440 min |
| Reintentos de captura | payments | Reintenta las capturas fallidas | 1 min |
| Webhooks de Mercado Pago | payments | Reprocesa notificaciones pendientes | 1 min |
| Renovación de tokens | payments | Renueva las vinculaciones de Mercado Pago por vencer | 60 min |

: Tareas periódicas del sistema.

## Registros y monitoreo

- Cada servicio expone `GET /health`; el del servicio de usuarios informa el estado de PostgreSQL y Redis.
- Los registros se emiten en formato JSON estructurado, con el identificador `x-request-id` que el gateway asigna a cada pedido y los servicios propagan, para seguir un pedido a través de varios servicios.
- Docker rota los registros de cada contenedor (10 MB por archivo, 3 archivos).
- Los problemas operativos del servicio de pagos (liquidaciones escaladas, holds perdidos) generan una **alerta al equipo** por el canal configurado (Telegram).
- La cuota diaria de Google Maps tiene un tope duro configurado en Google Cloud; revisar el consumo si el mapa o las rutas degradan.

::: pendiente
**Pendiente de confirmar con `movo-infra`:** la política de respaldo de PostgreSQL (frecuencia de los *snapshots*, retención y procedimiento de restauración) y el monitoreo externo de disponibilidad. Este manual no los documenta porque su definición está en el repositorio de infraestructura, no en este.
:::

## Seguridad operativa

- Los secretos nunca se versionan: están en Secrets Manager (ambientes), GitHub Secrets (CI) o `.env` ignorado por Git (local).
- El acceso de los servicios al bucket de imágenes se hace con el rol de IAM de la instancia, sin credenciales de AWS en la aplicación.
- El puerto 22 (SSH) está abierto a cualquier dirección porque el despliegue desde GitHub Actions no puede restringirse a un rango fijo; es una limitación aceptada y documentada. Se recomienda acceder solo con clave.
- Solo se publican los puertos 80 y 443; todo lo demás vive en la red interna de Docker.

# Solución de Problemas

| Síntoma | Causa probable | Qué hacer |
|---------------------------|--------------------------------------|----------------------------------|
| El servicio arranca pero usa un proveedor simulado en un ambiente real | La variable `*_PROVIDER` no está en el bloque `environment:` de Compose | Agregarla (ver la regla de las tres ubicaciones) y redesplegar |
| El servicio no arranca y el registro menciona un valor inválido de un enumerado | Variable presente pero vacía | Definir un valor válido o eliminarla del secreto |
| `prisma migrate deploy` falla con «P1013: invalid port number» | Contraseña de `DATABASE_URL` con caracteres reservados sin codificar | El *workflow* la codifica; verificar el formato del secreto |
| La migración supera los 600 segundos | Presión de disco o memoria en la instancia | Revisar `df -h` y `docker system df`; limpiar imágenes |
| Error 502 en el proxy | El gateway no está corriendo o tardó en arrancar | `docker compose ps` y los registros del gateway |
| Certificado vencido | Falló la renovación de Certbot | Renovar en el anfitrión y reiniciar el proxy |
| No llegan los códigos de verificación | Proveedor de SMS o correo mal configurado, o en modo consola | Revisar las variables del proveedor; en modo consola el código sale por el registro |
| Las imágenes no se descargan | Token de GHCR vencido o sin permisos | Renovar el secreto `GHCR_PAT` |
| El disco se llena | Imágenes huérfanas o registros | `docker image prune -af`; verificar la rotación de registros |
| Un cambio en `shared/` rompe un servicio | El servicio usa la versión compilada del paquete compartido | Reconstruir el paquete y el servicio; las pruebas de integración lo detectan |

: Diagnóstico de problemas frecuentes.

# Apéndice: Variables de Entorno

Las tablas siguientes se generan a partir de los archivos `.env.example` de cada servicio, que son la documentación vigente de sus variables. Las marcadas como «(secreto)» no deben versionarse ni compartirse. Las descripciones breves provienen de los comentarios del propio archivo; cuando no hay comentario propio de la variable, se indica con un guion.
