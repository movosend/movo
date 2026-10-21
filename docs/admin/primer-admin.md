# Cómo crear y gestionar el primer admin (MOVO-290)

El rol `admin` permite el acceso al panel de administración (`movo-admin`). Para crear el primer admin del sistema se utiliza el script de CLI de `movo-svc-users`. Una vez que existe un admin, la gestión habitual se realiza desde el panel a través de los endpoints internos de `svc-users` consumidos por `svc-admin` (MOVO-292).

## Requisitos previos

La persona debe:
1. Registrarse previamente desde la app (tener una cuenta en `users.users`).
2. Verificar su dirección de email (Perfil → Verificar email).
3. Mantener su cuenta en estado `active` (no suspendida ni eliminada).

## Comandos

### Local (desarrollo con `tsx`)

Desde el directorio `services/movo-svc-users`:

```bash
# Otorgar rol admin
npm run admin:grant:dev -- persona@movo.app

# Revocar rol admin
npm run admin:revoke:dev -- persona@movo.app
```

El script carga el `.env` local y reutiliza las definiciones del `envSchema` del servicio para validar las variables que necesita: `DATABASE_URL` y configuración de email; `revoke` también exige `REDIS_URL`. `grant` no requiere Redis ni `JWT_SECRET`.

### Dev / Producción (EC2 con Docker Compose)

En la EC2, desde el directorio donde reside `docker-compose.yml`:

```bash
# Otorgar rol admin
docker compose pull movo-svc-users && docker compose run --rm -T movo-svc-users npm run admin:grant -- persona@movo.app

# Revocar rol admin
docker compose run --rm -T movo-svc-users npm run admin:revoke -- persona@movo.app
```

Nota: El `pull` inicial asegura que se ejecute la versión más reciente de la imagen de producción.

## Códigos de salida

| Código | Significado |
|---|---|
| `0` | Operación exitosa (incluye idempotencia: si ya era admin, responde éxito sin modificar). |
| `1` | Error de configuración, infraestructura o negocio (ej. `USER_NOT_FOUND`, `ADMIN_GRANT_EMAIL_NOT_VERIFIED`, `ADMIN_GRANT_ACCOUNT_NOT_ACTIVE`, `ADMIN_NOT_FOUND`, `ADMIN_LAST_ADMIN`). |
| `2` | Error de sintaxis o argumentos faltantes en la invocación. |

## Reglas y garantías

- **Idempotencia**: otorgar el rol a quien ya lo tiene responde éxito (200) y no reenvía el email de aviso.
- **Aviso por email**: al otorgar el rol por primera vez, se envía un email transaccional informando el acceso al panel (best-effort; si el proveedor de email falla, el rol se mantiene otorgado).
- **Corte de sesiones de panel**: al revocar el rol, se invalidan inmediatamente las sesiones de panel en Redis (`panel-revoked-at:{userId}`) sin afectar las sesiones de la app móvil.
- **Invariante de último admin**: nunca se permite revocar ni eliminar la cuenta del último admin con capacidad de operar el panel (`active` y `emailVerified`), respondiendo 409 `ADMIN_LAST_ADMIN`.

El baneo de cuentas está pendiente de MOVO-296: deberá usar `ensureNotLastEligibleAdmin` dentro de la misma transacción que cambia el estado.
