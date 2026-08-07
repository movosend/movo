# movo-svc-users

Identidad, auth (JWT + refresh + OTP), KYC (Didit.me) y perfiles. Ver el `README.md` de
la raíz del repo para el setup general del monorepo (Docker Compose, convenciones,
testing) — esta página cubre únicamente lo específico de este servicio.

## Webhook de KYC en desarrollo local (MOVO-72)

`POST /kyc/webhook` necesita ser alcanzable desde internet para que Didit.me pueda
entregar el resultado de una verificación. En `api-dev.movosend.app` esto no es
problema (tiene IP pública); en local hace falta un túnel.

### Opción recomendada: `DIDIT_MODE=mock` (default)

Para la mayoría del desarrollo diario no hace falta tocar Didit real ni levantar un
túnel: con `DIDIT_MODE=mock` (default de `.env.example`), `POST /kyc/session` genera
una sesión sintética sin red, y podés simular el webhook vos mismo con un `POST` directo
a `http://localhost:3001/kyc/webhook` (o `app.inject()` en un test) con el payload y la
firma que corresponda — no depende de que Didit pueda alcanzarte.

### Probar contra el sandbox real de Didit.me

1. Conseguir credenciales de sandbox (API key, `workflow_id`) y configurar un
   "destino" de webhook desde la consola de Didit (**Business Console → API &
   Webhooks**) — devuelve un `secret_shared_key` una sola vez, guardarlo como
   `DIDIT_WEBHOOK_SECRET`.
2. Levantar un túnel hacia el puerto local del servicio (`3000` por default de
   `.env.example`, ver README raíz sección "Iterar sobre un solo servicio"):
   ```bash
   brew install cloudflared   # una sola vez, no pide cuenta/login
   cloudflared tunnel --url http://localhost:3000
   ```
   **Recomendado sobre `ngrok`/`localtunnel`**: no hace falta instalar nada con cuenta
   (a diferencia de `ngrok`, que hoy pide login incluso para el túnel gratis), y es
   bastante más confiable que `npx localtunnel` — probado en vivo durante MOVO-72: el
   servicio gratuito `loca.lt` de `localtunnel` se cayó solo a mitad de una prueba y una
   segunda instancia ni siquiera llegó a conectar, mientras que `cloudflared` respondió
   consistente en <1s.
3. Usar la URL pública que da `cloudflared` (`https://<algo>.trycloudflare.com`) +
   `/kyc/webhook` como destino del webhook en la consola de Didit (**Business Console →
   API & Webhooks → Webhooks → Añadir destino**, evento `status.updated` — es el único
   que aplica a una verificación de identidad por sesión, el resto (`business.*`,
   `transaction.*`, `travel_rule.*`, `user.*`) son de otras funcionalidades de Didit que
   Movo no usa). El `secret_shared_key` que te da al crear el destino es el
   `DIDIT_WEBHOOK_SECRET`. **Un solo destino alcanza** para todos los workflows de la
   cuenta (DNI y licencia incluidos) — no es por-workflow, el payload trae su propio
   `session_id` para que el receptor distinga de qué verificación se trata.
4. Setear en `.env`: `DIDIT_MODE=live`, `DIDIT_API_KEY`, `DIDIT_WORKFLOW_ID_IDENTITY`,
   `DIDIT_WEBHOOK_SECRET`. Si el archivo tiene valores con caracteres especiales (`&`,
   `@`, etc. — típico en passwords/secrets generados), **no lo cargues con
   `source .env`** (rompe el parser de bash) — usá un loop línea por línea:
   ```bash
   set -a
   while IFS='=' read -r key value; do
     [[ -z "$key" || "$key" == \#* ]] && continue
     export "$key=$value"
   done < .env
   set +a
   ```
5. La consola de Didit tiene **Business Console → API & Webhooks → "Probar Webhook"**,
   que manda payloads simulados completos por escenario (`Approved`/`Declined`/
   `In Review`, entre otros) sin tener que completar el flujo real de cámara/documento
   cada vez que se quiere probar el receptor. Ojo: el `session_id` que manda es fijo
   (dato de prueba de Didit, no una sesión real creada por `POST /kyc/session`) — el
   webhook va a llegar y la firma va a validar, pero el receptor lo va a marcar como
   "sesión desconocida" (AC7) y no va a tocar ningún dato, a menos que además hayas
   creado una sesión real con ese mismo `session_id` (no hay forma de elegirlo desde la
   consola).

Cualquier túnel equivalente sirve — lo importante es que la URL sea pública y apunte al
puerto local del servicio.
