# Lista de capturas pendientes del Manual de Usuario

Generada desde `datos/capturas.yaml`. Son **26 nuevas**, **26 para actualizar** y **16 para verificar** (68 en total). Las demás capturas del manual no cambian.

- **Nueva**: la pantalla o el estado no estaba en el manual. El texto y el lugar ya están en `manual.md`, y hasta que exista el archivo el PDF muestra un marco «Captura pendiente».
- **Actualizar**: la pantalla cambió en el Sprint 8; hay que volver a tomarla.
- **Verificar**: la pantalla puede haber cambiado según el estado; compararla con la actual y rehacerla solo si se ve distinta.

## Formato y nombres

- **Móvil:** simulador de iPhone 16 Pro, tema claro, barra de estado 9:41 (`capturas/preparar-simulador.sh`). PNG de 1206 x 2622 px en `assets/capturas/M-NN.png`; después `python3 capturas/enmarcar_todas.py M-94 M-95 ...` genera la versión con marco.
- **Panel:** Chrome a 1512 px de ancho, tema claro, sesión de administrador en dev. PNG de la página completa en `assets/capturas/W-NN.png`; el build recorta el blanco sobrante al pie.
- Reglas generales, cuentas de prueba y flujos de Maestro: `capturas/README.md` y `capturas/flujos/`.
- Revisar que no se vean datos reales de personas (nombre, teléfono, dirección).

## Datos de prueba que hay que preparar

| Capturas | Qué dejar armado |
|---|---|
| M-94, M-95, M-102 | Un emisor **sin deuda** para elegir «Efectivo» (M-94), y otro con un **saldo pendiente** con Movo para ver la opción bloqueada (M-95). M-102 se toma como transportista sobre un envío publicado en efectivo. |
| M-96, M-97, M-99 | Un envío **en efectivo** asignado (M-96), llevado hasta la **entrega** para ver el aviso del saldo (M-97), y otro asignado con **menos de 12 h** al retiro para cancelarlo con penalidad (M-99). |
| M-98 | Un transportista con una **deuda mayor a 30.000 ARS** (se carga con un ajuste manual de la cuenta corriente desde el panel). |
| M-100 | Una **cuenta nueva** (o borrar el registro del tutorial) para que aparezca el pop-up «Publicá un envío» sobre Inicio. |
| M-101 | Dos consultas de soporte: una abierta con respuesta del equipo sin leer y una resuelta. |
| W-19 a W-22 | Al menos una disputa **abierta** y una **resuelta**. Para W-21, abrir una abierta con el botón «Resolver disputa» y elegir «parcial». W-22 requiere forzar un fallo de pago en dev; si no se logra, se omite. |
| W-23 a W-25 | Un envío **asignado** sin retirar, con un administrador que **no sea parte**. El paso 3 envía un código de 6 dígitos al correo del administrador: tomar la captura antes de confirmar para no cambiar el estado. |
| W-26 | Un usuario con una **suspensión vigente** (aplicarla desde W-16 primero). |
| W-27 a W-33 | Rango de **30 días** con envíos completados, cobros y disputas. Si la red de dev tiene pocos datos, usar el selector **Datos: Demo** (queda el aviso amarillo, aceptable para el manual) o avisar para decidirlo. |
| W-34, W-35 | Bitácora con acciones de varios administradores (las de las capturas anteriores alcanzan). |

## Nuevas, aplicación móvil (9)

| Archivo | Qué es | Pantalla | Estado a dejar |
|---|---|---|---|
| `M-94` | Enviar, modalidad de pago en efectivo | `(app)/send (paso «Revisá y confirmá»)` | Selector «¿Cómo vas a pagar?» con «Efectivo» elegido y su descripción «Le pagás el monto completo en mano al transportista cuando retira el paquete». |
| `M-95` | Enviar, efectivo no disponible por saldo pendiente | `(app)/send (paso «Revisá y confirmá»)` | Cuenta con deuda: opción «Efectivo» atenuada, recuadro amarillo «Tenés un saldo pendiente con Movo…» y el botón «Pagar mi saldo». |
| `M-96` | Detalle del envío en efectivo (emisor) | `(app)/shipments/[id]` | Envío asignado en efectivo: fila «En efectivo al retiro» en lugar de «Reservado en tu tarjeta», sin tarjeta de fondos. |
| `M-97` | Entrega en efectivo, aviso del saldo | `(app)/shipments/[id]/delivery/success` | Entrega de un envío en efectivo: «Cobraste en efectivo», nota de que la comisión de Movo queda como saldo y el enlace a Saldo. |
| `M-98` | Requisitos, deuda de efectivo sobre el tope | `(app)/(tabs)/transport` | Transportista con deuda mayor a 30.000 ARS: fila de requisito de deuda de efectivo sin cumplir en la lista de requisitos. |
| `M-99` | Cancelar un envío en efectivo con penalidad | `(app)/shipments/[id] (hoja de cancelación)` | Hoja de cancelación de un envío en efectivo con menos de 12 h al retiro: la penalidad queda como saldo, sin texto de «reserva liberada». |
| `M-100` | Tutorial de primer uso | `(app)/(tabs)/home (tutorial)` | Pop-up guiado «Publicá un envío» del tutorial interactivo, sobre la pantalla de inicio de una cuenta nueva. |
| `M-101` | Mis consultas de soporte | `(app)/support/conversations` | Lista de consultas con una abierta con respuesta sin leer y una resuelta, con su código SOP. |
| `M-102` | Oferta en efectivo, «Cobrás en mano» | `(app)/transport/[id]/offer` | Pantalla de oferta sobre un envío en efectivo: insignia «Efectivo», «Cobrás en mano» en lugar de «Recibís aprox.» y la nota de que no hay procesamiento de pago. |

## Nuevas, panel de administración (17)

| Archivo | Qué es | Pantalla | Estado a dejar |
|---|---|---|---|
| `W-19` | Bandeja de disputas | `/disputes` | Disputas abiertas y resueltas con el contador de abiertas, filtros de estado, ciudad y fechas y el buscador por código o nombre. |
| `W-20` | Expediente de una disputa | `/disputes/[id]` | Disputa de usuario con descargos de las partes, historial de las partes, handshake, fotos del envío y notas internas. |
| `W-21` | Resolver una disputa | `/disputes/[id] (Resolver disputa)` | Resultado «parcial» con el 50 % elegido, razonamiento escrito y la vista previa de qué pasará con el dinero. |
| `W-22` | Disputa procesando el pago | `/disputes/[id]` | Disputa en «Procesando pago» con el botón de reintentar (se alcanza forzando un fallo de pago en dev; si no se puede, omitirla). |
| `W-23` | Cambiar estado, elegir el destino | `/shipments/[id] (Cambiar estado)` | Paso 1 de un envío asignado: destinos permitidos y los bloqueados con su motivo. |
| `W-24` | Cambiar estado, ver el impacto | `/shipments/[id] (Cambiar estado)` | Paso 2: qué se ejecuta, a quién se avisa, qué verificar y qué no se puede deshacer. |
| `W-25` | Cambiar estado, confirmar | `/shipments/[id] (Cambiar estado)` | Paso 3: motivo con el contador de 20 caracteres, el código del envío a tipear y el código de 6 dígitos por correo. |
| `W-26` | Levantar una sanción | `/users/[id] (diálogo)` | Diálogo para levantar la suspensión vigente, con motivo. |
| `W-27` | Métricas, Cashflow | `/metrics` | Pestaña Cashflow con rango de 30 días, tarjetas de GMV, comisión, take rate y ticket, tendencia y desgloses. |
| `W-28` | Métricas, Precio y volumen | `/metrics?tab=pricing` | Puente del GMV y cascada de fugas de captura. |
| `W-29` | Métricas, Entregas | `/metrics?tab=deliveries` | Entregas a tiempo, puerta a puerta e incidencias, con desglose por motivo de demora. |
| `W-30` | Métricas, Transportistas | `/metrics?tab=carriers` | Transportistas activos y asignados en 24 h. |
| `W-31` | Métricas, Distancias | `/metrics?tab=distances` | Mapa de corredores y comparación de los tres tramos. |
| `W-32` | Métricas, Soporte | `/metrics?tab=support` | Volumen y tiempos de soporte (sin filtro de distancia). |
| `W-33` | Métricas, Disputas | `/metrics?tab=disputes` | Embudo de abiertas a decididas y resueltas, y desglose por motivo. |
| `W-34` | Bitácora, línea de tiempo | `/audit-log` | Acciones de varios administradores con filtros de administrador, acción, objetivo y resultado. |
| `W-35` | Bitácora, detalle de una acción | `/audit-log (panel de detalle)` | Detalle abierto de una acción con su motivo y contexto. |

## Para actualizar, aplicación móvil (11)

| Archivo | Qué es | Pantalla | Estado a dejar | Por qué |
|---|---|---|---|---|
| `M-23` | Enviar, resumen y precio sugerido | `(app)/send` | Paso «Revisá y confirmá» con la tarjeta de precio sugerido en pesos. | Aparece el selector «¿Cómo vas a pagar?» (Tarjeta / Efectivo) en el resumen. |
| `M-24` | Enviar, alta demanda y precio actualizado | `(app)/send` | Resumen con la insignia «Alta demanda en tu zona» o el aviso «El precio se actualizó». | Mismo resumen, ahora con el selector de modalidad de pago. |
| `M-27` | Detalle del envío (emisor), esperando al receptor | `(app)/shipments/[id]` | Envío en «Esperando confirmación del receptor» con la línea de tiempo. | El detalle muestra la fila de modalidad de pago y un solo mapa. |
| `M-28` | Detalle del envío (emisor), con ofertas | `(app)/shipments/[id]` | Envío publicado con el aviso de ofertas recibidas. | Idem M-27, con el aviso de ofertas. |
| `M-29` | Receptor rechazó el envío | `(app)/shipments/[id]` | Banner de rechazo con la acción «Elegir otro receptor». | Idem M-27, con el banner de rechazo. |
| `M-36` | Fondos reservados | `(app)/shipments/[id]` | Detalle con la tarjeta «Fondos reservados» y la fecha de retiro. | Detalle con la fila de modalidad («Reservado en tu tarjeta») y un solo mapa. |
| `M-37` | Cancelar un envío asignado con penalidad | `(app)/shipments/[id] (hoja de cancelación)` | Hoja de cancelación con menos de 12 h al retiro, que muestra el monto de la penalidad. | La hoja usa el monto real del hold como «reservado» (MOVO-318) y el texto de liberación cambió. |
| `M-39` | Seguimiento en vivo | `(app)/shipments/[id]/tracking` | Mapa con la posición del transportista, la insignia «En vivo» y la llegada estimada. | El seguimiento ahora dibuja la ruta del transportista y lo ya recorrido, con un solo mapa, para emisor y receptor. |
| `M-59` | Mi ruta de hoy | `(app)/route/index` | Itinerario optimizado con paradas ordenadas, ETA y el botón «Navegar hasta esta parada». | Mi ruta dibuja el camino por calles recortado desde el vehículo y tiene marcador propio. |
| `M-66` | Entrega confirmada y cobro | `(app)/shipments/[id]/delivery/success` | Pantalla con «Te acreditamos» y el detalle del cobro. | Texto de éxito según quién confirma y monto con la comisión real de Mercado Pago. |
| `M-78` | Detalle de un cobro | `(app)/profile/payments/history/[id]` | Desglose «Cómo se compone»: pago del emisor, comisión de Movo, comisión de Mercado Pago y neto. | El desglose usa la comisión real de Mercado Pago (MOVO-285) y tiene variante en efectivo. |

## Para actualizar, panel de administración (15)

Casi todas se actualizan por la **barra lateral nueva** (suma **Disputas** y el grupo **Reportería**). Conviene tomarlas en la misma sesión, con la sesión ya iniciada y el tema claro.

| Archivo | Qué es | Pantalla | Estado a dejar | Por qué |
|---|---|---|---|---|
| `W-04` | Inicio del panel | `/` | Barra lateral con las secciones habilitadas y las que figuran como «Próximamente». | Inicio ahora es el resumen operativo de ocho bandejas, con la barra lateral nueva. |
| `W-05` | Búsqueda de usuarios | `/users` | Resultados de la búsqueda por nombre, email, teléfono o DNI. | La barra lateral cambió (suma Disputas y el grupo Reportería). |
| `W-06` | Ficha de usuario | `/users/[id]` | Encabezado con estado, roles y métricas, índice lateral de secciones y la sección «Datos y roles». | La barra lateral cambió (suma Disputas y el grupo Reportería). El encabezado y la sección Sanciones cambiaron (acciones de sanción). |
| `W-07` | Acciones sobre una cuenta | `/users/[id] (menú «Acciones»)` | Menú con cerrar sesiones, cambiar email o teléfono, ajustar el saldo, agregar nota y sancionar. | La barra lateral cambió (suma Disputas y el grupo Reportería). El menú Acciones suma Suspender, Inhabilitar y Levantar. |
| `W-08` | Ajustar el saldo | `/users/[id] (diálogo)` | Diálogo con monto, motivo y la casilla de confirmación, con el «Antes / Después». | La barra lateral cambió (suma Disputas y el grupo Reportería). |
| `W-09` | Listado de envíos | `/shipments` | Tabla con pestañas por grupo de estados, filtros y el buscador. | La barra lateral cambió (suma Disputas y el grupo Reportería). Los filtros del listado cambiaron. |
| `W-10` | Detalle de un envío | `/shipments/[id]` | Partes, retiro y entrega, paquete y pago, ofertas y línea de tiempo. | La barra lateral cambió (suma Disputas y el grupo Reportería). «Cambiar estado» está activo y el detalle resume la disputa si existe. |
| `W-11` | Seguimiento de un envío en el mapa | `/shipments/[id] (panel de seguimiento)` | Ruta, posición del transportista y progreso. | La barra lateral cambió (suma Disputas y el grupo Reportería). El seguimiento suma el tramo recorrido de envíos cerrados o en disputa. |
| `W-12` | Chat de un envío (solo lectura) | `/shipments/[id] (panel de chat)` | Historial del chat del envío. | La barra lateral cambió (suma Disputas y el grupo Reportería). |
| `W-13` | Bandeja de soporte | `/support` | Lista de consultas con filtros Todos, Míos, Sin asignar y la conversación abierta. | La barra lateral cambió (suma Disputas y el grupo Reportería). La bandeja corre con la API real, sin datos de prototipo. |
| `W-14` | Contexto del usuario en soporte | `/support/[id] (panel lateral)` | Panel con verificaciones, reputación, envíos recientes y conversaciones anteriores. | La barra lateral cambió (suma Disputas y el grupo Reportería). |
| `W-15` | Administradores | `/admins` | Tabla de administradores y el diálogo «Agregar administrador». | La barra lateral cambió (suma Disputas y el grupo Reportería). |
| `W-16` | Suspender una cuenta | `/users/[id] (diálogo)` | Diálogo con motivo visible para la persona, nota interna opcional y plazo (hasta una fecha o indefinida), antes de «Revisar». | Tomarla con la UI final del diálogo de sanción: motivo, nota interna, plazo y «Revisar» con el resumen. |
| `W-17` | Verificaciones y vehículo en la ficha | `/users/[id] (secciones KYC y Vehículo)` | Identidad con la lista de intentos, licencia de conducir, Mercado Pago y la ficha del vehículo. | La barra lateral cambió (suma Disputas y el grupo Reportería). La sección Sanciones muestra el estado del retiro de lo no comprometido. |
| `W-18` | Menú de la cuenta del administrador | `/ (menú del encabezado)` | Menú con el aviso de sesión de 8 horas, el cambio de tema y «Cerrar sesión». | El menú de la cuenta y la barra lateral cambiaron. |

## Para verificar, aplicación móvil (16)

| Archivo | Qué es | Pantalla | Estado a dejar | Por qué |
|---|---|---|---|---|
| `M-31` | Ofertas recibidas | `(app)/shipments/[id]/offers` | Lista de tres ofertas con el selector «Ordenar por: Menor precio / Mejor reputación». | La lista de ofertas puede mostrar la insignia «Efectivo»; comparar con la actual. |
| `M-32` | Elegir una oferta | `(app)/shipments/[id]/offers (modal)` | Modal «¿Elegir esta oferta?» con precio, fecha y botón «Confirmar elección». | El modal de elegir oferta cambió el texto para envíos en efectivo; comparar con la actual. |
| `M-46` | Receptor escanea el código de entrega | `(app)/shipments/[id]/handshake-scan` | Visor con el marco de escaneo y la indicación «Apuntá al código de la otra persona»; el fondo del visor es ilustrativo. | Cambió el texto del visor de escaneo; comparar. |
| `M-47` | Transportar, envíos disponibles | `(app)/(tabs)/transport` | Feed con tarjetas de paquetes cercanos, el radio de búsqueda y el botón de filtros. | Las tarjetas de envíos en efectivo llevan la insignia «Efectivo»; si no hay uno en el feed, crear uno. |
| `M-48` | Transportar, requisitos pendientes | `(app)/(tabs)/transport` | Transportista sin licencia verificada: tarjetas de requisitos (identidad, licencia, Mercado Pago). | La lista de requisitos suma filas (deuda de efectivo); comparar con la actual. |
| `M-50` | Detalle de un envío disponible | `(app)/transport/[id]` | Mapa de la ruta, precio sugerido, «Recibís aprox.» y el botón «Hacer una oferta». | El detalle de un envío disponible muestra la modalidad de pago; comparar. |
| `M-51` | Crear una oferta | `(app)/transport/[id]/offer` | Monto «Quiero cobrar», desglose de lo que paga el emisor y el deslizador «Deslizá para confirmar». | La pantalla de oferta calcula el cobro según la modalidad; comparar con un envío con tarjeta. |
| `M-53` | Mis ofertas | `(app)/carrier/offers/index` | Pestañas con ofertas «En juego», «Requieren algo tuyo» y cerradas, con sus pills de estado. | Las ofertas en efectivo llevan insignia; comparar. |
| `M-54` | Detalle de mi oferta | `(app)/carrier/offers/[id]` | Oferta pendiente con «Cambiar el precio», «Modificar fecha y horario» y «Retirar oferta». | El detalle de la oferta sigue la modalidad de pago; comparar. |
| `M-64` | Retiro confirmado | `(app)/shipments/[id]/pickup/success` | Pantalla «Retiro confirmado» con la dirección de entrega, la distancia y el tiempo de la ruta, y el botón «Ver la ruta». | El texto de éxito del handshake depende de quién confirma; comparar. |
| `M-65` | Entrega, código para el receptor | `(app)/shipments/[id]/delivery/qr` | QR del transportista con el nombre del receptor y la cuenta regresiva. | La entrega informa la distancia a la dirección sin bloquear; comparar. |
| `M-77` | Historial de pagos y cobros | `(app)/profile/payments/index (pestaña de historial)` | Movimientos agrupados por mes, con los filtros «Últimos 30 días / Este mes / Mes anterior». | El historial incluye filas «Pago en efectivo»; comparar. |
| `M-79` | Saldo pendiente y pagar mi saldo | `(app)/profile/payments/index (pestaña de saldo)` | Usuario con deuda: «Saldo pendiente», «Qué forma tu saldo» y «Pagar mi saldo». | El saldo suma la comisión de envíos en efectivo; comparar. |
| `M-88` | Ayuda y soporte | `(app)/support/index` | Pantalla con «Chatea con Soporte de Movo» y «Repasar el tutorial». | Soporte ahora corre contra la API real de agentes; comparar. |
| `M-89` | Nueva consulta de soporte | `(app)/support/new` | Formulario con el tema, el envío vinculado opcional, el texto y las fotos. | Idem M-88. |
| `M-90` | Conversación con soporte | `(app)/support/[id]` | Hilo con mensajes del usuario y del equipo de Movo. | Idem M-88, con respuesta de un agente. |

## Sin cambios

`W-01`, `W-02` y `W-03` (ingreso, verificación y recuperación) y el resto de las capturas móviles no se tocan.
