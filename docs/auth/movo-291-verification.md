# MOVO-291 — Verificación y aceptación

Revisión local del 14/10/2026, Node 22.22.2. Stack conservado:
#244 → #247 → #249 → MOVO-291, sin fusionar las dependencias.

| Criterio de Linear | Estado | Evidencia |
| --- | --- | --- |
| 1. Login y OTP, reenvío y errores genéricos | ✅ | Server Actions; tests de formulario, validación, pendiente, pegado, cooldown y cambio de cuenta |
| 2. Tokens exclusivamente en servidor/cookies protegidas | ✅ | Prueba HTTPS en Chrome: httpOnly, Secure, Strict y host-only; sin tokens en HTML, RSC ni almacenamiento JS; navegador no llama al gateway |
| 3. Refresh transparente y rechazo claro | ✅ local | DAL + handler; renovación y reintento único; errores transitorios conservan cookies; backend mantiene las 8 h absolutas |
| 4. Rutas protegidas | ✅ | Proxy redirige sin cookies; DAL valida perfil actual y permiso de panel; desafíos OTP se validan en servidor |
| 5. Layout, admin y logout | ✅ | Sidebar desktop de 240 px, header de 56 px con identidad y logout; ocho secciones futuras deshabilitadas; menú móvil, ambos temas y navegación por teclado |
| 6. Cliente de API, ApiError, request id y conflicto de interés | ✅ | Módulo server-only, no-store y tests del transporte/normalización |
| 7. Variables documentadas y configuradas en Vercel | ⚠️ | `.env.example` y `movo-admin/CLAUDE.md` completos; configuración remota queda a cargo del usuario |
| 8. Deploy contra api-dev | ⚠️ | Se conserva el despliegue automático desde GitHub del proyecto existente; no se accedió ni se modificó Vercel |
| 9. Documentación del paquete | ✅ | `movo-admin/CLAUDE.md` describe estructura, convenciones y despliegue |

## Pruebas ejecutadas

- Panel: lint, typecheck, build y suite completa (35 tests, Vitest/Testing Library).
- `svc-users`: lint, build y suite completa (720 tests). Después se agregó el caso
  explícito de logout durante emisión: la suite de sesión de panel pasó sus 31 tests.
- `svc-admin`: lint, build y suite completa (36 tests).
- Redis/Postgres reales: ocho refresh concurrentes con una sola rotación y respuestas
  iguales, ciphertext sin tokens en claro, reuso con otra clave o fuera de ventana,
  logout del token anterior/nuevo, revocación durante emisión y fallo incompleto sin
  consumir dos veces. Logout durante emisión revoca el hijo sin cortar otra sesión.
- Chrome headless por HTTPS local con los servicios reales y un gateway de prueba
  local: login → OTP → inicio → refresh concurrente en dos pestañas → logout y
  redirección de la otra pestaña. Sin errores JavaScript. El gateway de prueba no
  reemplaza la aceptación del gateway desplegado en dev.
- Inspección de capturas desktop/móvil, claro/oscuro; controles y foco de teclado,
  menú móvil y Escape, sin desbordes. Login/OTP también se comprobaron a 320 y 390 px,
  en ambos temas, sin errores de consola ni desbordes horizontales.

## Pendientes de aceptación contra dev

El flujo remoto requiere los endpoints de las PRs #244/#247/#249 y el soporte nuevo
para refresh idempotente de `svc-users` y `/admin/session` de `svc-admin` desplegados.
Esta rama no los despliega: el pipeline backend vigente publica `develop`; no se
fusionaron PRs ni se modificó ese pipeline. Desplegar las dependencias antes de aceptar
el frontend para evitar la detección de reuso con dos pestañas sobre un backend viejo.

El usuario confirmó que `admin.movosend.app` ya existe y despliega automáticamente
desde GitHub. Configurar las tres variables, Node 22 e inclusión de fuentes externas
al Root Directory según `movo-admin/CLAUDE.md`. Luego verificar con una cuenta admin
real login → OTP → inicio → vencimiento/refresh en dos pestañas → logout. No se marca
este punto como verificado por una prueba local ni por la mera existencia del dominio.
El ADR-043 es propuesto y queda pendiente de aceptación/publicación en Sprint 0.
