# DD-046 — Notificaciones push del chat con el texto y ráfagas en un resumen (MOVO-301)

> Borrador para pegar en `[Movo] 011-Registro de Decisiones de Diseño`. **Reemplaza el punto de ADR-023 que dice "push por
> mensaje, sin el texto"**; el resto de ADR-023 sigue vigente. 043 y 045 ya están tomados, 044 lo usa MOVO-309.

**Contexto.** ADR-023 decidió una push por mensaje, como mucho una por minuto y destinatario, sin el texto
("se vería en la pantalla bloqueada"). Probado con usuarios, no sirve: las pushes llegan en ráfagas sin
contenido ("Tenés un mensaje nuevo sobre un envío") y obligan a abrir la app para saber qué dijeron. WhatsApp,
el modelo mental de quien usa un chat, muestra quién escribe y qué, y agrupa lo que llega seguido.

**Decisión.** La push del chat pasa a ser como la de WhatsApp, con las limitaciones de Expo Push:

- **Lleva el texto.** Título: nombre y rol de quien escribe ("Ana · Emisor"); cuerpo: el mensaje, cortado a 140
  caracteres. El texto ya está enmascarado por el filtro de lenguaje y nunca se manda de un autor bloqueado
  (DD-026).
- **El primer mensaje avisa enseguida** y abre una ventana de 30 s (`CHAT_PUSH_WINDOW_SECONDS`) por destinatario
  y conversación. Los que llegan dentro de la ventana no mandan una push cada uno: se juntan en una cola de
  Redis y **al cerrarse la ventana sale un único resumen** ("3 mensajes nuevos · último texto"). La ventana y el
  resumen comparten un solo reloj (el resumen se agenda para cuando cierra la ventana vigente), así que un mensaje
  posterior nunca sale antes que uno anterior. Una ráfaga larga son como mucho dos avisos por ventana.
- **El resumen se decide al cerrar la ventana, no al encolar:** se relee el envío (rol y acceso pueden haber
  cambiado), se vuelven a filtrar los autores bloqueados, y no se manda si el destinatario ya leyó la conversación.
- **El mobile saca de la bandeja** las notificaciones de un chat cuando se abre la conversación.

**Alternativas descartadas.**
- *Una notificación que se actualiza* (como WhatsApp): Expo Push no expone identificador de reemplazo ni
  `thread-id`; habría que pasar a data-only pushes y notificaciones locales, que en iOS en segundo plano no son
  confiables.
- *Mantener la push sin texto* (ADR-023): es lo que se probó y molesta; la privacidad se resuelve con el bloqueo
  del dispositivo, como en cualquier app de mensajería.
- *Opción de usuario "mostrar contenido"*: queda como mejora posible en Configuración de notificaciones.

**Trade-offs aceptados.**
- El texto de un mensaje se ve en la pantalla bloqueada (decisión de privacidad revertida respecto de ADR-023).
- No hay reemplazo de notificaciones: el centro de notificaciones puede mostrar el primer aviso y el resumen.
- El resumen vive en un `setTimeout` del proceso (una sola réplica, ADR-006): un reinicio entre el primer mensaje
  y el cierre de la ventana lo pierde; el primer mensaje ya había avisado.
