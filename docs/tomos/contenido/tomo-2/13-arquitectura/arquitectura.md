# Visión General

Movo es una plataforma de logística distribuida punto a punto: conecta a quien necesita enviar un paquete con quien ya viaja esa ruta. Su arquitectura sigue un estilo de **microservicios** con un único punto de entrada público (ADR-001): una aplicación móvil y un panel web consumen un **API Gateway** que autentica, aplica límites de uso y enruta cada pedido al servicio dueño del dominio. Los servicios se comunican entre sí por REST síncrono sobre la red interna, sin *message broker*, y comparten una única instancia de PostgreSQL con **un esquema por servicio** (ADR-003), de modo que cada servicio es el único que escribe en sus tablas.

Las decisiones que más condicionan el diseño son las que sostienen las cuatro capas de confianza del producto: la **identidad** verificada por un tercero, la **custodia** probada con firma criptográfica y proximidad (ADR-020), el **pago** reservado y capturado solo al cumplirse la entrega (ADR-037) y la **reputación** acumulada. Este documento describe la arquitectura en tres vistas (contexto, contenedores y despliegue, siguiendo el modelo C4), el ambiente de implementación y el registro de decisiones.

# Vista de Contexto

El sistema Movo es usado por cuatro tipos de actores (emisor, transportista, receptor y administrador) y depende de ocho servicios externos, todos aislados detrás de interfaces que permiten reemplazarlos por simulaciones en desarrollo y pruebas.

![Vista de contexto: actores y sistemas externos.](diagrama:arq-contexto){.borde .sin-corte}

| Sistema externo | Uso | Decisión |
|------------------|--------------------------------------------------|---------|
| Didit.me | Verificación de identidad y de licencia de conducir (documento y prueba de vida) | n/a |
| Mercado Pago | Reserva y captura del pago, reparto entre transportista y Movo, vinculación de la cuenta del transportista por OAuth | ADR-035 |
| Google Maps Platform | Distancias y matriz de tiempos (Routes API), geocodificación y autocompletado de direcciones | ADR-015, ADR-014 |
| Twilio | Envío del código por SMS para verificar el teléfono | ADR-012 |
| Resend | Envío de correo electrónico (códigos y avisos) | ADR-017 |
| Expo Push Service | Entrega de notificaciones push a los dispositivos | n/a |
| ArcGIS Location Platform (Esri) | Teselas del mapa de seguimiento de envíos en el panel de administración | n/a |
| Amazon S3 | Fotos de envíos, de perfil, de reportes y adjuntos, con URLs prefirmadas | ADR-007, ADR-016 |

: Sistemas externos de los que depende Movo.

# Vista de Contenedores

El backend se compone de un gateway y cinco servicios de dominio, más Postgres y Redis. Solo el gateway (detrás de Nginx) es alcanzable desde fuera de la red interna.

![Vista de contenedores: gateway, servicios y almacenes de datos.](diagrama:arq-contenedores){.borde .sin-corte}

| Contenedor | Tecnología | Responsabilidad |
|------------------|----------------|--------------------------------------------------|
| `movo-mobile` | React Native + Expo | Aplicación para emisores, transportistas y receptores |
| `movo-admin` | Next.js (Vercel) | Panel de administración |
| `gateway` | Node.js + Fastify | Autenticación del JWT, límites de uso, restricción de cuentas sancionadas, ruteo y proxy de WebSockets |
| `movo-svc-users` | Node.js + Fastify | Identidad, sesiones, verificación (KYC), perfiles, notificaciones, reportes y bloqueos, sanciones |
| `movo-svc-shipments` | Node.js + Fastify | Envíos, ofertas, viajes, handshake, tracking, chat, soporte, disputas y valoraciones |
| `movo-svc-payments` | Node.js + Fastify | Reservas de fondos, capturas y reparto, tarjetas, vinculación de Mercado Pago, cuenta corriente |
| `movo-svc-admin` | Node.js + Fastify | Operaciones del panel: ficha de usuarios, administradores y bitácora de acciones |
| `movo-svc-pricing-logistics` | Python + FastAPI + OR-Tools | Motor de precios y optimización de rutas con ventanas horarias (VRPTW) |
| PostgreSQL 16 | n/a | Datos persistentes, un esquema por servicio |
| Redis 7 | n/a | Sesiones y refresh tokens, límites de uso, desafíos del handshake, candados de barridos, marcas de cuentas sancionadas |

: Contenedores del sistema.

El servicio de precios no se expone por el gateway: solo lo consume `movo-svc-shipments`. Todas las rutas públicas viven bajo el prefijo `/api/v1/`, con la excepción del chequeo de salud (`GET /health`).

# Vista de Despliegue

Cada ambiente (desarrollo y producción) es una instancia EC2 de AWS en la región `sa-east-1` que ejecuta todo el backend con Docker Compose (ADR-006). Nginx termina TLS con certificados de Let's Encrypt y reenvía al gateway; el DNS lo resuelve Cloudflare en modo *DNS-only* hacia una dirección IP elástica. El panel de administración se despliega aparte en Vercel. La aplicación móvil se distribuye mediante builds de EAS.

![Vista de despliegue: infraestructura de un ambiente.](diagrama:arq-despliegue){.borde .sin-corte}

La infraestructura se aprovisiona con Terraform en un repositorio separado, `movo-infra` (ADR-009), que define, entre otros recursos, la instancia, el bucket de imágenes y los registros DNS de cada ambiente.

## Integración y despliegue continuos

Los *workflows* de GitHub Actions automatizan la verificación y el despliegue:

1. **Pull request.** Con detección de cambios por ruta, se ejecutan *lint*, verificación de tipos y pruebas de cada paquete afectado contra PostgreSQL y Redis reales. El chequeo `tests-summary` bloquea el *merge* a `develop` y `main`.
2. **Integración en `develop`.** Se construye y publica en GHCR una imagen Docker por servicio con la etiqueta `dev`; luego se genera el archivo `.env` desde AWS Secrets Manager (`movo/dev/app-secrets`), se copian a la instancia el archivo de Compose y las plantillas de Nginx, se aplican las migraciones de Prisma servicio por servicio, se hace *pull* de las imágenes, se reinician los contenedores y se limpian las imágenes huérfanas.
3. **Producción.** El flujo equivalente se dispara al integrar `develop` en `main`, con sus propios secretos y su propia instancia.

Los secretos nunca están en el repositorio: en desarrollo local viven en un `.env` ignorado por Git, en los ambientes desplegados en Secrets Manager y en CI en GitHub Secrets.

# Ambiente de Implementación

## Software

| Componente | Versión |
|------------------|----------------------------------------|
| Node.js (servicios y gateway) | 20 (imagen `node:20-alpine`) |
| Fastify | 5 |
| TypeScript | 6 (modo estricto) |
| Prisma | 7 (con *driver adapter* para PostgreSQL) |
| Python (servicio de precios) | 3.12 (imagen `python:3.12-slim`) |
| FastAPI y OR-Tools | 0.115 y 9.15 |
| PostgreSQL | 16 |
| Redis | 7 |
| Nginx | 1.27 (imagen Alpine) |
| React Native / Expo (aplicación móvil) | 0.86 / SDK 57 |
| Next.js (panel de administración) | 16 |
| Docker Compose | Plugin v2 |

: Versiones del software del ambiente.

## Hardware y red

El backend completo corre en una única instancia EC2 por ambiente, por lo que no hay balanceo ni escalado automático: es una limitación aceptada para el alcance del proyecto (ADR-006), igual que la ausencia de alta disponibilidad. Los dos servicios de datos (PostgreSQL y Redis) corren como contenedores de la misma instancia, con el volumen `postgres-data` persistente. Los puertos 80 y 443 de Nginx son los únicos publicados; todo lo demás vive en la red de Docker `movo-net`. El puerto 22 (SSH) permanece abierto a cualquier dirección porque el despliegue desde GitHub Actions no puede limitarse a un rango fijo de direcciones; es una limitación aceptada y documentada.

## Operación

Los contenedores tienen política de reinicio automático y rotación de *logs* (`json-file`, 10 MB por archivo y 3 archivos). Al final de cada despliegue se ejecuta `docker image prune -af`, porque el disco reducido de la instancia se llena de imágenes sin etiqueta si no se limpia. El detalle de instalación y operación está en el Manual de Instalación y Operación (Tomo III).

# Seguridad

- **Autenticación.** Un JWT de acceso de 60 minutos y un *refresh token* opaco de 90 días en Redis, de un solo uso con detección de reuso: presentar un refresh ya canjeado revoca todas las sesiones del usuario (ADR-004, ADR-013). El panel tiene una sesión propia, con segundo factor por correo y duración máxima de 8 horas.
- **Autorización.** Los roles viajan en el token como un arreglo y el gateway inyecta la identidad verificada en encabezados internos que los servicios no revalidan (ADR-010). Es un modelo de confianza perimetral, no *zero-trust*.
- **Custodia.** Firma ECDSA P-256 del dispositivo, desafío efímero de 15 segundos y verificación de proximidad a 100 metros (ADR-020).
- **Datos sensibles.** Movo no almacena documentos ni datos biométricos de la verificación de identidad (solo el estado y la decisión redactada) ni números de tarjeta ni CVV; los tokens de Mercado Pago se guardan cifrados.
- **Limitación de uso.** Contadores en Redis por usuario y por ruta en el gateway, más límites específicos de cada flujo sensible (envío de códigos, cotizaciones, reportes).
- **Cumplimiento.** Términos y Condiciones y Política de Privacidad versionados con aceptación registrada, y purga automática de datos vencidos conforme a la Ley 25.326.

# Limitaciones Aceptadas

El equipo documentó explícitamente estas limitaciones de arquitectura como aceptadas, en lugar de dejarlas implícitas: ausencia de alta disponibilidad y de escalado automático (una instancia por ambiente); punto único de falla en la instancia de base de datos compartida, mitigado con esquemas separados y *snapshots*; acoplamiento temporal por el uso de REST síncrono, mitigado con el identificador `x-request-id` en los *logs*; modelo de confianza perimetral entre servicios; puerto SSH abierto; y dependencia de red de los servicios externos en el camino crítico de algunas operaciones, con las políticas de degradación descriptas en el documento de patrones de diseño.
