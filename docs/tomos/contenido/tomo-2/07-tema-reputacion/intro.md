# Descripción del Tema

**EP-06 · Reputación y Comunidad** es la cuarta capa de confianza: el historial verificable de lo que cada persona hizo en la plataforma. Tras la entrega, las tres partes de un envío pueden calificarse durante 72 horas; esas calificaciones alimentan un **score de reputación** que se muestra en el perfil y que también desempata las ofertas de los transportistas (tema *Asignación y Negociación*). Además, cualquier usuario puede **reportar** a otro con evidencia fotográfica y **bloquearlo**, con efectos concretos sobre el feed, las ofertas y el chat.

El score no es un promedio simple: aplica una contracción bayesiana hacia la media global y un decaimiento temporal, para que ni una sola calificación perfecta ni una vieja distorsionen la imagen de una persona. Es un cálculo del lado de `movo-svc-shipments` que `movo-svc-users` compone en el perfil.

**Servicios involucrados:** `movo-svc-shipments` (calificaciones y cálculo de reputación), `movo-svc-users` (perfil, reportes y bloqueos), `gateway` y `movo-mobile`; **externo:** Amazon S3 (fotos de los reportes).
