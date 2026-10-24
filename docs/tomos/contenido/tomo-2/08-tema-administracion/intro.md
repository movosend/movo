# Descripción del Tema

**EP-07 · Gestión y Administración** agrupa lo que el equipo de Movo necesita para operar la plataforma y resolver problemas: un **panel web de administración** con acceso protegido por un segundo factor, la **ficha completa de cada usuario**, el **monitoreo de envíos** (incluido el seguimiento en el mapa), las **sanciones de cuenta** (suspensión e inhabilitación), las **disputas**, el **soporte** dentro de la app y el **cumplimiento legal** (Términos, Privacidad y Ley 25.326).

Toda acción de escritura del panel pasa por `movo-svc-admin`, que aplica la regla de conflicto de interés y deja una bitácora inmutable. Es el tema con más historias todavía abiertas: la resolución de disputas con reembolsos, las métricas de oferta y demanda, la corrección manual del estado de un envío y la API de la bandeja de soporte para agentes se documentan aquí con su estado real y casos de prueba marcados como pendientes, en lugar de omitirse.

**Servicios involucrados:** `movo-admin` (panel Next.js), `movo-svc-admin`, `movo-svc-users`, `movo-svc-shipments`, `movo-svc-payments`, `gateway` y `movo-mobile`.
