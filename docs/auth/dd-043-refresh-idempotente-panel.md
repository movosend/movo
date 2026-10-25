# DD-043 (propuesto): refresh idempotente del panel en una ventana de 10 segundos

## Contexto

MOVO-287 separa sesiones de panel y app; conserva la rotación de un solo uso y la
revocación por reuso de ADR-013. Next puede recibir varias solicitudes simultáneas
con la misma cookie de refresh, incluso desde dos pestañas o instancias distintas.
Una rotación estricta interpretaría ese comportamiento normal como robo de token.
Un mutex en memoria del BFF no coordina instancias de Vercel.

## Decisión

`POST /auth/admin/refresh` acepta `Idempotency-Key` opcional (16–128 caracteres
alfanuméricos, `_` y `-`). No cambia el cuerpo de respuesta. El BFF deriva una clave
estable por refresh mediante HMAC-SHA256 con `MOVO_SESSION_SECRET`, exclusivo del
servidor. No usa identificadores de pestaña ni de request como clave de rotación.

`svc-users` coordina en Redis por hash del token completo (`panel-rotation:*`). Un
`SET NX EX 10` elige al propietario y una marca con nonce identifica su lease. El
propietario consume el refresh con la operación atómica existente y emite un solo
par. Publica por compare-and-set únicamente si la marca sigue siendo la suya.
El resultado compartido dura 10 segundos desde la publicación; está cifrado con
AES-256-GCM (IV aleatorio, clave derivada con separación de dominio del token opaco
completo, que contiene un secreto aleatorio de 256 bits). Redis guarda hashes de los
identificadores y ciphertext; no guarda access/refresh en claro.

Duplicados con la misma clave esperan hasta 2 segundos por la publicación y reciben
el mismo resultado. Antes de devolverlo se comprueban elegibilidad actual del usuario,
vencimiento absoluto, existencia/hash/consumo del refresh hijo y marca de revocación.
Logout coloca una lápida atómica antes de revocar, impide publicar una rotación en
curso y, si ya se publicó, revoca también al hijo. Un logout repetido sigue siendo
idempotente y no corta otras sesiones del administrador.

Distinta clave, solicitudes sin clave o repeticiones después de la ventana mantienen
la detección de reuso anterior. Una rotación incompleta no se vuelve a consumir durante
la ventana: devuelve 503 recuperable mientras permanece pendiente; fuera de ella, el
consumo previo provoca rechazo/revocación. Una lease vencida no puede sobrescribir una
nueva marca ni sobrevivir a logout; el hijo de una publicación rechazada se revoca.
La sesión nunca extiende sus 8 horas. La política de la app no cambia.

## Consecuencias y límites

Se acepta una excepción acotada a la rotación estricta para el panel: un duplicado
legítimo puede obtener durante 10 segundos los mismos tokens. La clave estable y
el refresh son necesarios para ello; no se abre un endpoint de consulta por clave.
La dependencia de Redis permanece fail-closed. Un atacante que ya tenga el refresh
y la clave en esa ventana puede obtener ese resultado, limitado por la elegibilidad,
revocación y vencimiento. Las respuestas de refresh nunca se serializan al navegador:
Next solo escribe cookies host-only, httpOnly, Secure y SameSite=Lax (revisión de PR #253: Strict descartaba la sesión al abrir el panel desde un link externo; los POST cross-site siguen sin cookies y se valida el Origin).

Se prueba con Redis/Postgres reales: concurrencia, igualdad de respuestas, ciphertext,
reuso con otra clave o fuera de ventana, logout de ambos tokens, revocación durante
emisión y resultado pendiente sin segundo consumo. Aceptación del ADR y publicación
en el registro de decisiones de diseño pendientes de revisión del equipo.
