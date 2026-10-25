# Descripción del Tema

**EP-01 · Identidad y Confianza** agrupa todo lo que permite que dos desconocidos confíen el uno en el otro a través de Movo: el registro de cuentas, la verificación del teléfono y de la identidad (KYC), el inicio y la gestión de la sesión, el perfil y sus insignias, la verificación de la licencia de conducir del transportista y el ciclo de vida de la cuenta (cambio de datos, recuperación de acceso y baja).

Es la primera de las cuatro capas de confianza del producto (identidad, custodia, pagos y reputación): ningún usuario opera sin haber demostrado quién es. Se resuelve en `movo-svc-users` (identidad, sesión y KYC), en el API Gateway (autenticación del token en cada pedido) y en la aplicación móvil (wizard de registro, pantallas de sesión y perfil).

**Servicios involucrados:** `gateway`, `movo-svc-users`, `movo-mobile`; **externos:** Didit.me (KYC), proveedor de SMS (Twilio, detrás de la interfaz `SmsProvider`, ADR-012) y de email (Resend, `EmailProvider`, ADR-016).
