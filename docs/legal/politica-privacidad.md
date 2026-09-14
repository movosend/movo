# Política de Privacidad de MOVO

**Versión**: 0.1 (borrador de trabajo)
**Última actualización**: 2026-09-14
**Vigencia**: aún no publicada / no vigente

> ## ⚠️ Aviso académico — leer antes de usar este documento
>
> MOVO es el proyecto final de la carrera Ingeniería en Sistemas de Información,
> UTN Facultad Regional Córdoba (equipo: Ariza, Bordino Blanche, Dalmagro, Yorlano,
> Vergara). Este documento es un **borrador exhaustivo con fundamento en la
> legislación argentina vigente** (ver referencias normativas a lo largo del
> texto), redactado como entregable académico del TFG. **No constituye
> asesoramiento legal certificado.** Antes de publicarlo como política vigente
> para usuarios reales fuera del ámbito de evaluación académica, debe ser
> revisado y validado por un abogado/a matriculado/a especializado en protección
> de datos y derecho del consumidor.
>
> Los campos marcados `[A COMPLETAR]` requieren una decisión del equipo (datos de
> contacto reales, domicilio legal, etc.) antes de considerarse un documento
> definitivo.

## 0. Índice

1. Quiénes somos y alcance de esta política
2. Qué datos recopilamos
3. Datos sensibles y biométricos (KYC)
4. Finalidades y bases legales del tratamiento
5. Con quién compartimos tus datos (encargados de tratamiento)
6. Transferencias internacionales de datos
7. Cuánto tiempo conservamos tus datos
8. Tus derechos (ARCO) y cómo ejercerlos
9. Menores de edad
10. Seguridad de la información
11. Cookies y tecnologías similares
12. Registro ante la Agencia de Acceso a la Información Pública (AAIP)
13. Cambios a esta política
14. Contacto

---

## 1. Quiénes somos y alcance de esta política

MOVO es una plataforma de logística distribuida peer-to-peer (P2P) que conecta
personas que necesitan enviar un paquete (**Emisores**) con personas que ya
están viajando esa ruta y pueden transportarlo (**Transportistas**), para que
un tercero (**Receptor**) lo reciba. Un **Administrador** interno del equipo de
MOVO monitorea la plataforma y resuelve disputas.

Esta Política de Privacidad aplica a:

- La aplicación móvil de MOVO (Emisores, Transportistas, Receptores).
- El panel de administración interno.
- El sitio web institucional de MOVO.
- Todos los servidores y sistemas de backend que dan soporte a lo anterior.

**Responsable del tratamiento de datos**: el equipo de desarrollo de MOVO, en
el marco del Trabajo Final de la carrera Ingeniería en Sistemas de
Información, Universidad Tecnológica Nacional, Facultad Regional Córdoba
(UTN FRC), con domicilio de referencia en Maestro M. López esq. Cruz Roja
Argentina, Ciudad Universitaria, Córdoba, Argentina, y correo de contacto
[privacy@mail.movosend.app](mailto:privacy@mail.movosend.app).

Esta política se rige, entre otras normas, por la **Ley 25.326 de Protección de
los Datos Personales** ("Habeas Data") y su normativa reglamentaria dictada por
la **Agencia de Acceso a la Información Pública (AAIP)**, autoridad de
aplicación en Argentina.

## 2. Qué datos recopilamos

Recopilamos datos en distintos momentos del uso de la app. La siguiente tabla
resume qué se recolecta, en qué paso del producto, y en qué servicio de backend
vive.

| Categoría                            | Datos concretos                                                                                                                                                             | Cuándo se recolecta                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Identificación                       | Nombre, apellido, DNI (número y fotos del documento)                                                                                                                        | Registro                                                   |
| Verificación de identidad (KYC)      | Selfie/video de verificación de vida ("liveness"), resultado de validación documental                                                                                       | Registro, antes de operar como Transportista               |
| Verificación de licencia de conducir | Foto de la licencia, resultado de validación                                                                                                                                | Alta de perfil de Transportista                            |
| Contacto                             | Teléfono, email (y verificación por código de un solo uso)                                                                                                                  | Registro y cambios posteriores                             |
| Cuenta                               | Contraseña, foto de perfil, biografía                                                                                                                                       | Registro y edición de perfil                               |
| Ubicación                            | Direcciones guardadas (retiro/entrega), geolocalización puntual al elegir una dirección                                                                                     | Creación de envíos, gestión de direcciones                 |
| Ubicación en tiempo real             | Posición GPS durante el traslado activo de un envío                                                                                                                         | Mientras un envío está en tránsito                         |
| Handshake criptográfico              | Clave pública asociada a tu dispositivo, usada para confirmar de forma segura que el paquete cambió de manos; la clave privada correspondiente nunca sale de tu dispositivo | Primer inicio de sesión tras generarse el par de claves    |
| Vehículo                             | Marca, modelo, patente, capacidad de carga                                                                                                                                  | Alta de ficha de vehículo (Transportista)                  |
| Contenido del envío                  | Fotos del paquete, descripción, peso/dimensiones declaradas                                                                                                                 | Creación de un envío                                       |
| Pagos                                | Datos de la transacción (monto, estado, comisión) — los **datos de la tarjeta/medio de pago en sí los procesa Mercado Pago**, MOVO no los almacena                          | Al ofertar/aceptar un envío y pagar                        |
| Reputación                           | Calificaciones (1-5 estrellas) y comentarios de texto sobre otro usuario tras una entrega                                                                                   | Al calificar dentro de la ventana de 72 horas post-entrega |
| Dispositivo                          | Identificador de dispositivo, token de notificaciones push                                                                                                                  | Login, activación de notificaciones                        |
| Soporte y disputas                   | Motivo de cancelación/rechazo, contenido de reclamos gestionados por un Administrador                                                                                       | Cancelación, rechazo, disputa de un envío                  |
| Registros técnicos (logs)            | Dirección IP, marcas de tiempo, acciones realizadas                                                                                                                         | En toda interacción con la plataforma                      |
| Navegación web                       | Cookies/almacenamiento local en los sitios web de MOVO                                                                                                                      | Al usar esos sitios en un navegador                        |

No recopilamos, a propósito, datos de salud, religión, opinión política,
orientación sexual ni afiliación sindical.

## 3. Datos sensibles y biométricos (KYC)

Consideramos **datos sensibles** a la selfie/video de verificación de vida
("liveness") y a las imágenes del DNI y de la licencia de conducir procesadas
durante el flujo de KYC. Aunque la Ley 25.326 (Art. 2) no menciona
explícitamente "datos biométricos" en su definición de "datos sensibles", la
Agencia de Acceso a la Información Pública los trata en la práctica con el
más alto estándar de cuidado, y así los tratamos nosotros también.

- El KYC lo ejecuta **Didit.me**, un proveedor externo especializado, bajo su
  propia política de privacidad y medidas de seguridad. MOVO recibe de Didit
  únicamente el **resultado** de la verificación (aprobado/rechazado/en
  revisión manual) y metadatos asociados (fecha, tipo de verificación) — no
  almacena una copia propia de las imágenes biométricas más allá de lo que el
  flujo de verificación requiera de forma transitoria.
- Tu consentimiento para este tratamiento queda comprendido en la aceptación
  general de esta Política y de los Términos y Condiciones al registrarte
  (checkbox de "Leí y acepto los Términos y la Política de Privacidad" del
  registro). **Un consentimiento explícito y diferenciado, pedido
  puntualmente antes de iniciar el flujo de KYC** (en vez de cubierto por el
  checkbox general de registro), es la implementación deseable dado que se
  trata de un dato sensible — está identificado como trabajo pendiente,
  todavía no implementado en el producto.
- Si tu verificación es rechazada o expira sin completarse, podés reintentarla;
  los intentos previos no exitosos no te habilitan a operar como Transportista
  y son reemplazados por el intento vigente.
- Nunca compartimos tus datos biométricos con otros usuarios de la plataforma
  ni los usamos con fines distintos a verificar tu identidad para poder operar
  de forma segura en MOVO.

## 4. Finalidades y bases legales del tratamiento

| Finalidad                                                                                 | Base legal (Ley 25.326, Art. 5)                                                                                         |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Crear y administrar tu cuenta, autenticarte                                               | Ejecución de un contrato del que sos parte (los Términos y Condiciones)                                                 |
| Verificar tu identidad (KYC) antes de habilitarte a operar                                | Consentimiento explícito (dato sensible) + interés legítimo de seguridad de la plataforma                               |
| Conectar Emisores con Transportistas, calcular precios y rutas                            | Ejecución del contrato                                                                                                  |
| Procesar pagos y comisiones                                                               | Ejecución del contrato + obligaciones ante el proveedor de pagos (Mercado Pago)                                         |
| Confirmar la entrega vía handshake criptográfico y validación de proximidad GPS           | Ejecución del contrato (integridad de la transferencia de custodia)                                                     |
| Mostrar calificaciones y reputación entre usuarios                                        | Interés legítimo (confianza dentro de la plataforma) + consentimiento implícito al participar del sistema de reputación |
| Enviarte notificaciones operativas (estado de tu envío, OTP, alertas de viaje compatible) | Ejecución del contrato                                                                                                  |
| Resolver disputas y dar soporte                                                           | Ejecución del contrato + interés legítimo                                                                               |
| Prevenir fraude y abuso de la plataforma                                                  | Interés legítimo                                                                                                        |
| Cumplir obligaciones legales (ej. requerimientos de autoridad competente)                 | Cumplimiento de una obligación legal                                                                                    |

No usamos tus datos para publicidad de terceros ni los vendemos.

## 5. Con quién compartimos tus datos (encargados de tratamiento)

Compartimos datos con los siguientes proveedores, únicamente en la medida
necesaria para prestar el servicio, y bajo sus propias políticas de
privacidad y medidas de seguridad:

| Proveedor                     | Qué le compartimos                                                        | Para qué                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Didit.me**                  | Documento de identidad, selfie/liveness, licencia de conducir             | Verificación de identidad (KYC) — ver sección 3                                                 |
| **Twilio**                    | Número de teléfono                                                        | Envío de códigos de verificación por SMS                                                        |
| **Resend**                    | Dirección de email                                                        | Envío de emails transaccionales (verificación, notificaciones)                                  |
| **Google (Maps Platform)**    | Direcciones de retiro/entrega (texto y coordenadas)                       | Conversión de direcciones en coordenadas y cálculo de rutas/distancias para el motor de precios |
| **Mercado Pago**              | Datos necesarios para procesar el pago y el split entre las partes        | Procesamiento de pagos, retención de fondos (hold) y liquidación al Transportista               |
| **Amazon Web Services (AWS)** | Fotos de perfil y de paquetes; datos de cuenta y de la aplicación         | Alojamiento de la aplicación y almacenamiento de archivos                                       |
| **Cloudflare**                | Resolución DNS del tráfico hacia nuestros servidores                      | Enrutamiento y protección básica de red                                                         |
| **Vercel**                    | Código y tráfico de nuestros sitios web                                   | Alojamiento de los frontends web                                                                |
| **Google Analytics** _(candidata, no integrada)_  | Datos de navegación en nuestros sitios web, si se integra (ver sección 11)               | Analítica de uso del sitio                                                                      |
| **Microsoft Clarity** _(candidata, no integrada)_ | Datos de navegación e interacción en nuestros sitios web, si se integra (ver sección 11) | Analítica de uso del sitio                                                                      |

No transferimos tus datos a ningún otro tercero salvo que la ley nos obligue
(por ejemplo, un requerimiento judicial) o que vos lo autorices expresamente.

**Fotos de perfil — nota de transparencia**: las fotos de perfil se
almacenan en un bucket con lectura pública (URL estable, sin necesidad de
autenticación para verla) porque cumplen una función de identificación entre
las partes de un envío (para que la contraparte te reconozca al momento de la
entrega). Si conocés la URL exacta de una foto podés verla sin loguearte —
elegí una foto que estés cómodo/a mostrando públicamente.

## 6. Transferencias internacionales de datos

Varios de los proveedores listados en la sección 5 (Didit.me, Twilio, Resend,
Google, AWS, Mercado Pago, Cloudflare, Vercel) procesan datos en servidores
ubicados fuera de la República Argentina. La Ley 25.326 (Art. 12) restringe la
transferencia internacional de datos personales a países que no cuenten con
niveles de protección adecuados, salvo determinadas excepciones (entre ellas,
el consentimiento del titular o que la transferencia sea necesaria para la
ejecución de un contrato entre el titular y el responsable).

Al aceptar esta Política de Privacidad y los Términos y Condiciones, **consentís
expresamente** estas transferencias internacionales, necesarias para poder
prestarte el servicio (verificar tu identidad, enviarte notificaciones,
calcular rutas, procesar pagos y alojar la aplicación).

## 7. Cuánto tiempo conservamos tus datos

| Dato                                               | Plazo de retención propuesto                                                                                                                                                | Motivo                                                                                                                                                                                                     |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Datos de cuenta (nombre, contacto, foto, DNI)      | Mientras la cuenta esté activa                                                                                                                                              | Necesarios para operar                                                                                                                                                                                     |
| Resultado de verificación KYC                      | Mientras la cuenta esté activa + 2 años desde la baja                                                                                                                       | Trazabilidad ante disputas/fraude                                                                                                                                                                          |
| Historial de envíos (ruta, precio, fotos, eventos) | Mientras la cuenta esté activa + 5 años desde la baja                                                                                                                       | Antecedente para disputas, reputación y eventuales requerimientos fiscales/legales; alineado al plazo genérico de prescripción de acciones del Código Civil y Comercial (Art. 2560)                        |
| Ubicación GPS en tiempo real                       | Solo mientras el envío está en tránsito; no se conserva un historial de trayectoria más allá de lo necesario para el handshake                                              | Minimización de datos — no hay necesidad de negocio de guardar la traza completa                                                                                                                           |
| Calificaciones y comentarios                       | Indefinidamente mientras ambas cuentas existan (son parte del historial de reputación público)                                                                              | Confianza entre usuarios de la plataforma                                                                                                                                                                  |
| Sesión activa                                      | Se renueva periódicamente y se revoca automáticamente ante actividad sospechosa                                                                                             | Seguridad de la sesión                                                                                                                                                                                     |
| Logs de servidor                                   | Rotación automática, no se conservan indefinidamente                                                                                                                        | Operación/debugging                                                                                                                                                                                        |
| Datos tras la baja de cuenta                       | **Anonimizados** (nombre/teléfono/email sobrescritos): el registro deja de ser identificable, salvo lo que deba conservarse por obligación legal (ej. comprobantes de pago) | Derecho de supresión (Ley 25.326, Art. 16) — implementado como anonimización en vez de borrado físico total, para preservar la integridad del historial de otros usuarios (ej. calificaciones ya emitidas) |

**Nota de transparencia sobre la baja de cuenta**: cuando pedís la baja de tu
cuenta (Perfil → Cuenta y seguridad → Eliminar cuenta), tu nombre, teléfono y
email se sobrescriben de forma irreversible y tus sesiones activas se revocan.
No podés dar de baja tu cuenta si tenés envíos activos o disputas abiertas —
te lo indicamos en el momento con un mensaje explícito.

**Nota sobre el historial de envíos compartido**: un envío involucra al menos
a dos usuarios (Emisor y Transportista, más el Receptor). Si uno de ellos da
de baja su cuenta antes de que venza el plazo de retención, su parte de los
datos se anonimiza, pero el registro del envío en sí puede persistir mientras
la otra parte lo necesite como antecedente (por ejemplo, para sostener su
propia calificación o una disputa en curso).

**Nota sobre registros incompletos**: si nunca terminás de registrarte
(por ejemplo, verificás el teléfono por OTP pero abandonás el flujo antes de
crear la cuenta, o iniciás el KYC de Transportista y no lo completás), los
datos ya cargados hasta ese punto quedan sujetos a los mismos plazos y
mecanismos de esta tabla — hoy no existe una purga automática diferenciada
para registros incompletos, es trabajo pendiente (ver el mismo estado de
MOVO-230 más abajo).

El proceso automático que hace cumplir estos plazos (purga del resultado de
KYC vencido, purga/anonimización del historial de envíos vencido, y de
registros incompletos) está trackeado como trabajo pendiente en MOVO-230 — el
compromiso de plazos de esta tabla es real, pero su cumplimiento automático
todavía no está implementado. Mientras esa issue no cierre, cualquier pedido
de supresión fuera de estos plazos se atiende igual de forma manual ante un
reclamo
concreto (sección 8).

## 8. Tus derechos (ARCO) y cómo ejercerlos

De acuerdo a los Arts. 14 a 20 de la Ley 25.326, tenés derecho a:

- **Acceso**: saber qué datos tuyos tenemos y para qué los usamos.
- **Rectificación**: corregir datos inexactos o desactualizados.
- **Cancelación (supresión)**: pedir la eliminación de tus datos cuando ya no
  sean necesarios o hayas retirado tu consentimiento (ver la limitación
  operativa de la sección 7 sobre anonimización).
- **Oposición**: oponerte a un tratamiento específico por un motivo legítimo.

**Cómo ejercerlos**:

- La mayoría de estos derechos ya están disponibles vos mismo/a desde la app,
  sin necesidad de escribirnos: editar tu perfil (nombre, foto, bio, teléfono,
  email — Perfil → Editar perfil) y dar de baja tu cuenta (Perfil → Cuenta y
  seguridad → Eliminar cuenta).
- Para cualquier otro pedido (acceso completo a tus datos, oposición a un
  tratamiento puntual, dudas), escribinos a
  [privacy@mail.movosend.app](mailto:privacy@mail.movosend.app). Vamos a responder dentro de los
  15 días hábiles desde la recepción del pedido.
- Tenés derecho, además, a interponer una denuncia ante la **Agencia de Acceso
  a la Información Pública** (AAIP) — Av. Pte. Julio A. Roca 710, Piso 4,
  CABA — si considerás que no dimos una respuesta adecuada a tu pedido.

## 9. Menores de edad

MOVO está destinado a personas mayores de 18 años. No recolectamos a sabiendas
datos de menores de edad. Si detectamos que una cuenta pertenece a una persona
menor de edad, la suspenderemos y eliminaremos los datos asociados, salvo que
la ley exija su conservación.

## 10. Seguridad de la información

Aplicamos medidas técnicas y organizativas para proteger tus datos, entre
ellas:

- Contraseñas almacenadas de forma irreversible (nunca en texto plano).
- Comunicación cifrada entre la app y nuestros servidores.
- Sesiones de corta duración con renovación automática y segura, con
  detección de uso indebido que revoca todas las sesiones activas ante un
  intento sospechoso.
- El handshake de confirmación de entrega usa criptografía asimétrica: la
  clave privada de tu dispositivo nunca se transmite ni se almacena en
  nuestros servidores.
- Acceso interno restringido: solo un punto de entrada controlado está
  expuesto públicamente, con controles de acceso internos adicionales.

Dado que procesamos datos biométricos (ver sección 3), aplicamos el nivel de
medidas de seguridad más exigente que contempla la normativa de la AAIP
(Resolución AAIP 47/2018) para ese tipo de datos.

**Ninguna plataforma es 100% infalible.** Si detectamos un incidente de
seguridad que pueda afectar tus datos personales, te lo notificaremos junto
con la AAIP cuando corresponda, describiendo el incidente y las medidas
adoptadas.

## 11. Cookies y tecnologías similares

Si nuestros sitios web (`movo-admin`, sitio institucional) incorporan
herramientas de analítica de terceros, estas serían las candidatas — a la
fecha de esta versión, **ninguna de las dos está integrada todavía en
`movo-admin`** (no verificado en el repo del sitio institucional, que es un
repo separado sin relación funcional):

| Herramienta           | Qué hace                                                                                                          | Datos que recolecta                                                                                                                                             |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Google Analytics**  | Mide visitas, páginas vistas y comportamiento agregado de navegación                                              | Identificador de cookie, dirección IP (truncada según configuración de Google), dispositivo/navegador, páginas visitadas                                        |
| **Microsoft Clarity** | Genera mapas de calor y grabaciones de sesión de la navegación en el sitio, para entender cómo se usa la interfaz | Interacciones en pantalla (clics, scroll, movimiento del mouse), dispositivo/navegador, páginas visitadas — enmascara automáticamente campos de texto sensibles |

Si en el futuro se integra alguna, ninguna se usaría para identificarte
individualmente ni para publicidad de terceros — el objetivo sería
exclusivamente entender y mejorar el uso de nuestros sitios, y esta sección
se actualizaría para reflejar la integración real (herramienta efectivamente
instalada, no solo evaluada) antes de considerarse vigente. Podés rechazar
cookies desde la configuración de tu navegador, o instalar el complemento de
exclusión de Google Analytics
([tools.google.com/dlpage/gaoptout](https://tools.google.com/dlpage/gaoptout))
si alguna vez se activa. Estas herramientas no se usan en la aplicación
móvil.

La aplicación móvil no usa cookies (no es un entorno de navegador), pero sí
utiliza almacenamiento seguro local de tu dispositivo para tu sesión y tu
clave criptográfica — ese almacenamiento nunca sale de tu dispositivo salvo
lo explícitamente descripto en este documento.

## 12. Registro ante la Agencia de Acceso a la Información Pública (AAIP)

El Art. 21 de la Ley 25.326 exige inscribir toda base de datos que contenga
datos personales en el Registro Nacional de Bases de Datos, hoy administrado
por la AAIP.

**Estado actual**: mientras MOVO opera exclusivamente como proyecto académico
(TFG) sin producción real con usuarios masivos, el equipo decide **no
realizar esta inscripción**, aceptando el riesgo regulatorio correspondiente
— mismo criterio que el proyecto ya documenta para otras limitaciones
aceptadas propias de su alcance académico. Si MOVO pasa a operar con usuarios
reales fuera del ámbito de evaluación académica, esta inscripción debe
completarse antes de ese lanzamiento.

## 13. Cambios a esta política

Podemos actualizar esta Política de Privacidad para reflejar cambios en
nuestras prácticas o en la normativa aplicable. Vamos a indicar la fecha de
"Última actualización" al inicio del documento y, ante cambios sustanciales,
te lo notificaremos dentro de la app antes de que entren en vigencia.
Conservamos un historial de versiones para poder acreditar qué versión
aceptaste y cuándo.

## 14. Contacto

Para cualquier consulta sobre esta Política de Privacidad o el tratamiento de
tus datos personales, escribinos a [privacy@mail.movosend.app](mailto:privacy@mail.movosend.app).

---

_Ver también: [Términos y Condiciones de Uso](./terminos-y-condiciones.md)._
