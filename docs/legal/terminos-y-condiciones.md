# Términos y Condiciones de Uso de MOVO

**Versión**: 0.1 (borrador de trabajo)
**Última actualización**: 2026-09-13
**Vigencia**: aún no publicada / no vigente

> ## ⚠️ Aviso académico — leer antes de usar este documento
>
> MOVO es el proyecto final de la carrera Ingeniería en Sistemas de Información,
> UTN Facultad Regional Córdoba (equipo: Ariza, Bordino Blanche, Dalmagro,
> Yorlano, Vergara). Este documento es un **borrador exhaustivo con fundamento
> en la legislación argentina vigente**, redactado como entregable académico
> del TFG. **No constituye asesoramiento legal certificado.** Antes de
> publicarlo como términos vigentes para usuarios reales fuera del ámbito de
> evaluación académica, debe ser revisado y validado por un abogado/a
> matriculado/a.
>
> Los campos marcados `[A COMPLETAR]` requieren una decisión del equipo antes
> de considerarse un documento definitivo.

## 0. Índice

1. Aceptación y capacidad para contratar
2. Definiciones
3. Descripción del servicio y rol de MOVO
4. Registro de cuenta y verificación de identidad
5. Roles y responsabilidades de cada actor
6. Objetos prohibidos
7. Precios, comisiones y pagos
8. Formación del contrato de transporte entre Emisor y Transportista
9. Ejecución del envío: retiro, tránsito, handshake y entrega
10. Cancelaciones y penalidades
11. Disputas y reclamos
12. Calificaciones, reputación y moderación de contenido
13. Responsabilidad y limitaciones
14. Suspensión y terminación de cuentas
15. Propiedad intelectual
16. Privacidad
17. Derecho de arrepentimiento (Ley 24.240)
18. Modificaciones a estos Términos
19. Ley aplicable y jurisdicción
20. Contacto

---

## 1. Aceptación y capacidad para contratar

Al registrarte y usar MOVO aceptás estos Términos y Condiciones de Uso (los
"Términos") en su totalidad. Si no estás de acuerdo, no debés usar la
aplicación.

Para usar MOVO declarás que:

- Sos **mayor de 18 años** y tenés capacidad legal para contratar según el
  Código Civil y Comercial de la Nación.
- La información que nos proporcionás (identidad, contacto, documentación)
  es veraz, completa y te pertenece.
- Usás la plataforma para vos mismo/a, no en representación de un tercero sin
  su consentimiento.

## 2. Definiciones

- **MOVO**: la plataforma tecnológica (aplicación móvil, panel de
  administración, backend) descripta en estos Términos.
- **Emisor**: usuario que solicita el envío de un paquete y paga por el
  servicio.
- **Transportista**: usuario que declara una ruta/viaje, acepta transportar
  envíos de otros usuarios y cobra por ello.
- **Receptor**: persona que recibe el paquete y confirma su entrega. Puede o
  no tener cuenta propia en MOVO, según el flujo de confirmación vigente.
- **Administrador**: personal interno de MOVO que monitorea la plataforma y
  resuelve disputas.
- **Envío**: la operación completa de transporte de un paquete desde un punto
  de retiro hasta un punto de entrega, gestionada dentro de la plataforma.
- **Oferta**: propuesta de precio que un Transportista hace sobre un Envío
  publicado por un Emisor.
- **Handshake criptográfico**: el mecanismo de confirmación de custodia del
  paquete (entre Emisor-Transportista, y luego Transportista-Receptor)
  mediante criptografía asimétrica y validación de proximidad GPS.
- **KYC** ("Know Your Customer"): proceso de verificación de identidad
  requerido para operar, en particular como Transportista.

Un mismo usuario puede actuar como Emisor y Transportista en distintos
Envíos, o incluso simultáneamente en Envíos distintos.

## 3. Descripción del servicio y rol de MOVO

MOVO es una **plataforma de intermediación tecnológica** que conecta a
Emisores con Transportistas para facilitar el transporte P2P de paquetes,
mediante un algoritmo de precios dinámico y optimización de rutas. **MOVO no
transporta paquetes, no es parte del contrato de transporte que se celebra
entre el Emisor y el Transportista**, y no es un servicio de correo,
mensajería ni logística tradicional.

**Aviso de riesgo — a tener presente en la redacción final**: la
jurisprudencia argentina reciente ha mostrado una tendencia a extender
responsabilidad a plataformas de intermediación (marketplaces) más allá de lo
que sus términos de uso declaran, especialmente cuando la plataforma
interviene en el cobro, la fijación de precios o la resolución de disputas —
como hace MOVO. Esta cláusula de "mero intermediario" reduce pero **no
elimina** el riesgo de que un tribunal considere a MOVO co-responsable ante un
reclamo de consumidor. Este riesgo se documenta explícitamente y debe
evaluarse con asesoramiento legal antes de cualquier lanzamiento real.

MOVO sí:

- Verifica la identidad de sus usuarios (KYC) antes de habilitarlos a operar
  como Transportistas.
- Calcula un precio sugerido y optimiza rutas mediante su motor de
  precios/logística.
- Procesa el cobro al Emisor y la liquidación al Transportista a través de
  Mercado Pago, reteniendo su comisión.
- Provee el mecanismo de confirmación de custodia (handshake criptográfico).
- Modera disputas y calificaciones dentro de los límites descriptos en estos
  Términos.

## 4. Registro de cuenta y verificación de identidad

- El registro requiere datos de identidad (nombre, DNI), contacto (teléfono
  verificado por OTP, email) y una contraseña.
- Para operar como **Transportista** es obligatorio aprobar un proceso de
  verificación de identidad (KYC) mediante un proveedor externo
  especializado. Ver la [Política de Privacidad](./politica-privacidad.md)
  para el detalle de qué datos se procesan en este paso.
- Sos responsable de mantener la confidencialidad de tu contraseña y de toda
  actividad que ocurra en tu cuenta. Notificanos de inmediato ante cualquier
  uso no autorizado.
- MOVO puede rechazar un registro o una verificación de identidad a su sólo
  criterio, sin obligación de expresar causa, cuando existan indicios
  razonables de fraude o incumplimiento de estos Términos.

## 5. Roles y responsabilidades de cada actor

### 5.1 Emisor

- Es responsable de declarar honestamente el contenido, peso y dimensiones
  del paquete, y de que no contenga objetos prohibidos (sección 6).
- Es responsable de estar disponible en el punto y ventana horaria de retiro
  acordados.
- Es quien paga el precio acordado con el Transportista, más las comisiones
  aplicables.

### 5.2 Transportista

- Es responsable de la custodia, cuidado y entrega en tiempo y forma del
  paquete durante el transporte, en los términos del contrato de transporte
  de cosas regulado por el Código Civil y Comercial de la Nación
  (Arts. 1280 a 1318).
- Es responsable de la veracidad de los datos de su vehículo y de contar con
  la documentación habilitante (licencia de conducir vigente, seguro del
  vehículo si correspondiera según la normativa de tránsito aplicable).
- Es quien percibe el precio ofertado y aceptado, neto de la comisión de
  MOVO y de los costos de procesamiento de pago.

### 5.3 Receptor

- Es responsable de confirmar la recepción del paquete mediante el mecanismo
  de handshake (QR/validación de proximidad) al momento de la entrega.
- Puede aceptar o rechazar la recepción de un envío antes de que sea
  publicado a Transportistas.

### 5.4 MOVO (plataforma)

- Ver sección 3.

## 6. Objetos prohibidos

Está prohibido usar MOVO para transportar:

- Sustancias ilegales o estupefacientes.
- Armas de fuego, explosivos o materiales peligrosos/inflamables no
  autorizados.
- Dinero en efectivo, metales preciosos o joyas de alto valor.
- Animales vivos.
- Mercadería robada o de procedencia ilícita.
- Cualquier objeto cuyo transporte esté prohibido o restringido por la
  legislación argentina vigente (aduanera, sanitaria, de tránsito, u otra
  aplicable).

Los **bienes perecederos** (alimentos, plantas, medicamentos que requieran
cadena de frío, u otros bienes sensibles al tiempo o la temperatura) sí están
permitidos, bajo responsabilidad exclusiva del Emisor: MOVO no ofrece cadena
de frío, empaque especializado, ni garantiza un tiempo máximo de tránsito
para este tipo de bienes. El Emisor asume el riesgo de deterioro por el
tiempo de tránsito real del envío, y MOVO no es responsable por ese
deterioro salvo que se origine en una demora imputable al Transportista más
allá de lo razonablemente informado al aceptar la oferta.

El Emisor es el único responsable frente a terceros y autoridades por el
contenido declarado del paquete. MOVO puede exigir la apertura o inspección
del paquete ante sospecha razonable de incumplimiento de esta sección, y
suspender la cuenta del Emisor infractor (sección 14).

## 7. Precios, comisiones y pagos

- El precio de un Envío surge de una **oferta** que el Transportista realiza
  sobre un precio sugerido calculado por el motor de precios de MOVO (hoy una
  implementación provisoria basada en distancia y peso, sujeta a evolución —
  ver nota de transparencia abajo).
- MOVO cobra una **comisión del 15%** sobre el precio acordado, deducida al
  momento de liquidar al Transportista.
- El procesamiento de pagos se realiza a través de **Mercado Pago**, que
  también puede aplicar una comisión propia por transacción
  (`[A COMPLETAR — porcentaje pendiente de confirmación contractual con
  Mercado Pago]`). Este costo se muestra como estimado al Transportista antes
  de confirmar su oferta.
- **Nota de transparencia sobre el motor de precios**: el precio sugerido que
  ve el Emisor al crear un envío usa hoy un modelo provisorio (distancia
  euclidiana + peso + tipo de paquete), no un cálculo de mercado en tiempo
  real basado en demanda o combustible. El precio final de cada Envío es
  siempre el que resulta de la oferta aceptada, no el sugerido.
- El pago del Emisor queda retenido (hold) hasta el momento correspondiente
  del ciclo de vida del Envío, y se libera al Transportista tras la
  confirmación de entrega — la mecánica exacta de esta retención depende de
  la integración vigente con Mercado Pago, que puede evolucionar.
- Todos los precios se expresan en pesos argentinos (ARS).

## 8. Formación del contrato de transporte entre Emisor y Transportista

Al aceptar una oferta, se perfecciona un contrato de transporte de cosas
entre el Emisor y el Transportista, regido por el Código Civil y Comercial de
la Nación, del cual **MOVO no es parte** (sección 3). MOVO actúa como
facilitador tecnológico de ese acuerdo y como procesador del pago asociado.

## 9. Ejecución del envío: retiro, tránsito, handshake y entrega

- El retiro y la entrega se confirman mediante un **handshake criptográfico**:
  un mecanismo de intercambio de claves asimétricas combinado con validación
  de proximidad GPS, diseñado para reducir la posibilidad de confirmar una
  entrega sin que el paquete haya cambiado de manos realmente.
- Durante el tránsito, la ubicación del Transportista se comparte en tiempo
  real dentro de la plataforma para que las partes del Envío puedan hacer
  seguimiento.
- Ni el Emisor ni el Receptor deben compartir el código/QR de confirmación
  con nadie fuera del flujo de la app — hacerlo puede permitir una
  confirmación de entrega fraudulenta, de la cual MOVO no es responsable.

## 10. Cancelaciones y penalidades

- Un Envío puede cancelarse por el Emisor mientras no tenga fondos
  confirmados con un Transportista asignado, sin penalidad.
- Cancelar un Envío con un Transportista ya asignado y fondos comprometidos
  puede estar sujeto a una penalidad, según el estado del Envío al momento de
  la cancelación — la mecánica de penalidades ligada a la liberación de
  fondos retenidos está `[A COMPLETAR — pendiente de definición final del
  circuito de retención y liberación de pagos]`.
- Un Receptor puede rechazar la recepción de un Envío antes de que sea
  publicado a Transportistas.

## 11. Disputas y reclamos

- Ante una controversia (paquete dañado, no entregado, contenido distinto al
  declarado, etc.), cualquiera de las partes puede iniciar una disputa dentro
  de la app.
- Un Administrador de MOVO revisa la evidencia disponible (fotos, eventos del
  Envío, calificaciones, comunicación registrada en la plataforma) y puede
  proponer una resolución.
- **MOVO no garantiza un resultado específico de la disputa ni actúa como
  árbitro con poder vinculante** — su rol es de mediación de buena fe sobre
  la base de la información disponible en la plataforma. Las partes conservan
  sus derechos y acciones legales conforme al derecho común.
- MOVO no es responsable por el contenido, valor o estado del paquete más
  allá de lo que la plataforma puede verificar objetivamente (fotos
  registradas, eventos de estado, confirmaciones de handshake).

## 12. Calificaciones, reputación y moderación de contenido

- Tras una entrega, las partes involucradas pueden calificarse mutuamente
  (1 a 5 estrellas + comentario opcional) dentro de una ventana de 72 horas.
- Los comentarios de calificación son contenido generado por el usuario. Sos
  responsable de que tus comentarios no sean difamatorios, injuriosos ni
  violen el derecho al honor de terceros (Art. 1770 del Código Civil y
  Comercial de la Nación).
- MOVO puede remover un comentario que incumpla lo anterior, a pedido de la
  persona afectada o de oficio, sin que ello genere derecho a indemnización a
  favor de quien lo publicó.
- Las calificaciones no pueden editarse fuera de la ventana de 72 horas ni
  eliminarse unilateralmente, salvo intervención de un Administrador ante una
  denuncia fundada.

## 13. Responsabilidad y limitaciones

- MOVO pone sus mejores esfuerzos para operar la plataforma de forma
  continua y segura, pero **no garantiza disponibilidad ininterrumpida** —
  como proyecto académico (TFG), no ofrece un SLA (acuerdo de nivel de
  servicio) formal ni soporte 24/7.
- MOVO no es responsable por daños indirectos, lucro cesante, o pérdidas
  derivadas del uso o imposibilidad de uso de la plataforma, salvo dolo o
  culpa grave de su parte.
- **MOVO no asume responsabilidad por la pérdida, daño, robo o entrega
  fuera de término de un paquete durante el transporte.** Esa responsabilidad
  recae exclusivamente en el Transportista, como parte del contrato de
  transporte de cosas celebrado directamente con el Emisor (sección 8), en
  los términos de los Arts. 1280 a 1318 del Código Civil y Comercial de la
  Nación. MOVO no es parte de ese contrato, no cobra un seguro sobre el
  contenido del envío, y no verifica el contenido real del paquete más allá
  de lo declarado por el Emisor.
- Nada en esta sección limita los derechos irrenunciables que la Ley 24.240
  de Defensa del Consumidor reconoce a los usuarios que califiquen como
  consumidores.

**Aviso de riesgo — postura elegida deliberadamente agresiva**: esta es la
postura de deslinde más fuerte de las evaluadas para este documento (frente a
la alternativa de un tope atado al valor declarado del envío). Es la que
menos expone a MOVO en el texto, pero también la que un tribunal tiene más
margen para considerar abusiva frente a un Emisor que califique como
consumidor (Ley 24.240), en particular porque MOVO sí interviene en el cobro,
la fijación de precios y la resolución de disputas (ver el aviso de riesgo de
la sección 3). Esta cláusula reduce el riesgo declarado en el texto, pero no
lo elimina en los hechos — debe revisarse con asesoramiento legal antes de
cualquier lanzamiento real.

## 14. Suspensión y terminación de cuentas

MOVO puede suspender o dar de baja una cuenta, con o sin previo aviso según
la gravedad, ante:

- Incumplimiento de estos Términos (incluyendo el transporte de objetos
  prohibidos, sección 6).
- Sospecha razonable de fraude, suplantación de identidad o uso de
  documentación falsa.
- Reincidencia en disputas resueltas en contra del usuario.
- Contenido inapropiado en calificaciones/comentarios (sección 12).

Podés dar de baja tu propia cuenta en cualquier momento desde Perfil → Cuenta
y seguridad → Eliminar cuenta, salvo que tengas Envíos activos o disputas
abiertas. Ver la [Política de Privacidad](./politica-privacidad.md) para el
tratamiento de tus datos tras la baja.

## 15. Propiedad intelectual

- El software, diseño, marca y contenido propio de MOVO (no generado por
  usuarios) son propiedad de sus creadores. No se otorga ninguna licencia
  sobre ellos más allá del uso normal de la app conforme a estos Términos.
- El contenido que subís (fotos de paquete, foto de perfil, comentarios de
  calificación) sigue siendo tuyo, pero le otorgás a MOVO una licencia no
  exclusiva para mostrarlo dentro de la plataforma en la medida necesaria
  para prestar el servicio (por ejemplo, mostrar la foto del paquete a la
  contraparte de un Envío).

## 16. Privacidad

El tratamiento de tus datos personales se rige por nuestra
[Política de Privacidad](./politica-privacidad.md), parte integrante de estos
Términos.

## 17. Derecho de arrepentimiento (Ley 24.240)

La Ley 24.240 (Art. 34) y la Resolución 424/2020 reconocen un derecho de
arrepentimiento de 10 días corridos para compras a distancia, cuando el
usuario califica como consumidor.

**Este derecho no aplica una vez aceptada una oferta sobre un Envío.** El
Art. 34 exceptúa expresamente de este derecho a los servicios cuya ejecución
ya comenzó con consentimiento expreso del consumidor. En MOVO, aceptar una
oferta perfecciona el contrato de transporte y pone en marcha su ejecución de
inmediato (el Transportista se organiza para el retiro pactado) — encuadra en
esa excepción.

Antes de aceptar una oferta, el Emisor puede cancelar el Envío sin cargo
(sección 10), lo que cumple una función equivalente de protección sin
necesidad de invocar el derecho de arrepentimiento sobre un servicio ya en
ejecución.

## 18. Modificaciones a estos Términos

Podemos modificar estos Términos para reflejar cambios en el servicio o en la
normativa aplicable. Te notificaremos dentro de la app ante cambios
sustanciales antes de que entren en vigencia, y conservamos un historial de
versiones para acreditar qué versión aceptaste y cuándo.

## 19. Ley aplicable y jurisdicción

Estos Términos se rigen por las leyes de la República Argentina. Para
cualquier controversia que no pueda resolverse mediante los mecanismos de
disputa de la sección 11, las partes se someten a la jurisdicción de los
Tribunales Ordinarios de la Ciudad de Córdoba, Provincia de Córdoba, con
renuncia expresa a cualquier otro fuero, sin perjuicio de las reglas de
competencia irrenunciables que la Ley 24.240 reconoce a los consumidores
(que pueden optar por el fuero de su domicilio).

## 20. Contacto

Para consultas sobre estos Términos, escribinos a
[privacy@mail.movosend.app](mailto:privacy@mail.movosend.app).

---

*Ver también: [Política de Privacidad](./politica-privacidad.md).*
