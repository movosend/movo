---
name: cerrar-us
description: Checklist de cierre de una User Story de MOVO antes de pedir review o mergear — compara la implementación contra los criterios de aceptación y la Definition of Done del ticket de Linear, corre tests, revisa si falta un ADR, actualiza CLAUDE.md y prepara commits agrupados. Usar siempre que alguien diga "cerremos esta US", "che, ¿cumplimos todo del ticket?", "terminé MOVO-XXX", "revisá el ticket antes de pushear", "hagamos el checklist de cierre", o pida verificar una historia/tarea de Linear contra el código antes de abrir o aprobar un PR.
---

# Cerrar una US de MOVO

Checklist para cerrar una User Story con confianza de que no falta nada del ticket,
antes de que el equipo pida review o mergee. Este flujo salió de cerrar MOVO-68
(middleware del gateway) — encontramos ahí mismo tres gaps reales (un AC mal
interpretado, un límite de rate-limiting que competía en silencio consigo mismo, y
alcance de sprint que se había colado de más) que un "se ve bien" superficial no
hubiera detectado. La disciplina de comparar explícitamente contra el ticket, ítem por
ítem, es lo que los atrapó.

## Por qué este orden importa

Revisar el ticket **antes** de tocar código evita re-derivar los criterios de memoria a
mitad de la implementación. Revisarlo **de nuevo al final**, ítem por ítem contra el
código real (no contra lo que uno cree que escribió), es lo que atrapa las
desviaciones — sobre todo en tickets largos con guías de implementación y DoD
separados del checklist de ACs, donde es fácil cumplir 10 de 12 puntos y dar por
sentado que el resto también quedó bien.

## Paso 1 — Traer el ticket completo

Buscá el ticket en Linear (`get_issue` con `includeRelations: true`) por su ID
(`MOVO-XXX`). Si el usuario no dio el ID en el pedido, **preguntáselo primero** — no
sigas de largo asumiendo cuál es. Si el nombre de la branch o el último commit ya
traen un `MOVO-XXX` claro, podés proponerlo ("¿es MOVO-72, el de la branch actual?")
para que lo confirme en vez de tener que escribirlo de cero, pero la confirmación
sigue siendo del usuario: nunca uses un ID inferido sin que lo valide, porque todo el
resto del checklist se arma sobre ese ticket — si es el equivocado, la tabla de
verificación completa queda mal desde el paso 1.

Prestá atención a:
- **`blockedBy`**: si el ticket que bloquea a este no está en estado terminado, avisá
  antes de asumir que las dependencias (ej. una librería compartida) ya existen.
- Los **criterios de aceptación** suelen estar numerados y ser verificables uno por
  uno — tratalos como una checklist literal, no como una descripción general.
- Las **guías de implementación** a veces incluyen restricciones de alcance explícitas
  ("no implementar todavía X", "solo Y está vivo este sprint") que no son ACs pero sí
  son parte de lo que hay que respetar. Es fácil pasarlas por alto porque no están en
  la lista numerada.
- La **Definition of Done adicional** (tests específicos, ADR, actualización de
  documentación) es una lista aparte de los ACs — cumplir los ACs no implica haber
  cumplido la DoD.

## Paso 2 — Armar la tabla de verificación

Antes de tocar código o después de terminar la implementación (este checklist sirve en
ambos momentos), leé los archivos relevantes y armá una tabla explícita: un renglón por
AC/guía/DoD, con veredicto (✅ / ⚠️ / ❌) y la razón. No respondas "sí, está todo" sin
esta tabla — es la tabla la que fuerza a mirar cada punto por separado en vez de una
impresión general del diff.

Para cada punto marcado ⚠️ o ❌, considerá si es:
- Un **bug real** a corregir antes de seguir, o
- Una **decisión ambigua del ticket** que requiere criterio (ej. un AC que da un
  ejemplo concreto pero un alcance más amplio en el texto) — en ese caso, no asumas
  la interpretación más amplia ni la más angosta en silencio: decidí con criterio,
  dejalo explícito en la tabla, y si el trade-off es significativo, preguntale al
  usuario en vez de asumir.

Si algo de la DoD no es un artefacto de código (ej. un ADR), decilo explícitamente en
vez de omitirlo de la tabla — los ADRs de MOVO viven en Google Drive
(`[Movo] 004 - Sprint 0.md`), no en este repo. Ver la sección de ADRs en `CLAUDE.md`
para el formato y la convención (un ADR aceptado no se modifica; si hace falta
documentar algo nuevo, se agrega un ADR nuevo con el próximo número).

## Paso 3 — Correr todo lo que el ticket exige verificar

- Build del/los paquete(s) tocado(s) (`npm run build` o equivalente).
- Test suite completa del paquete, no solo los tests nuevos — para agarrar
  regresiones en código que ya andaba.
- Si el ticket pide tests de integración puntuales (ej. "sin token → 401, con token
  válido → pasa..."), confirmá que existe un test que ejercita *exactamente* ese
  escenario, no uno parecido.
- Si aparece un fallo pasando de un valor esperado a otro completamente distinto (ej.
  200 → 404, o 200 → 500) después de un cambio, no lo descartes como "flaky" — leé el
  log real del error antes de reintentar. En MOVO-68, tres bugs distintos (un plugin
  de Fastify que ignoraba el `prefix`, una comparación de paths que no tenía en cuenta
  un prefijo nuevo, y un rate-limiter que se pisaba a sí mismo) se identificaron
  leyendo el mensaje de error real y a veces el código fuente de la librería en
  cuestión, no adivinando.

## Paso 4 — Cobertura, no como número sino como historia

Si la cobertura baja después de sacar código de alcance (por ejemplo, comentar una
ruta que ya no aplica este sprint), no inventes un test artificial solo para subir el
número — explicá por qué esa rama quedó inactiva y confirmá que el mecanismo en sí
sigue teniendo un test dedicado en otro lado. Es más valioso un número honesto con
explicación que un 100% forzado con un test que no representa nada real.

## Paso 5 — Actualizar `CLAUDE.md`

Sumá una entrada en la sección **"Estado actual de la implementación"** de
`CLAUDE.md` (raíz del repo), siguiendo el mismo formato que ya usan las entradas de
MOVO-67/68: qué se implementó, en qué archivos, decisiones clave tomadas (sobre todo
las que no son obvias mirando el diff), y qué queda pendiente o fuera de alcance.
3-5 líneas por decisión no obvia alcanza — no dupliques el detalle que ya vive en el
commit o en el PR.

## Paso 6 — Comentario en Linear (si aplica)

Si en el camino se tomaron decisiones de criterio que un reviewer no puede inferir
del diff (un AC interpretado de una forma en vez de otra, un placeholder a la espera
de otra US, una zona de conflicto conocida en un archivo compartido), redactá un
comentario corto para el ticket y **mostráselo al usuario antes de postearlo** — es
una acción visible para todo el equipo, no la publiques sin confirmación.

## Paso 7 — Commits

Agrupá los cambios en commits lógicos (ver convención de commits en `CLAUDE.md`):
típicamente uno por capa (ej. cambios en librería compartida, implementación,
tests, docs), no un commit gigante ni uno por archivo. Seguí el formato
`tipo(scope): descripción (MOVO-XXX)` que ya usa el historial del repo. **Nunca te
agregues como coautor salvo que el usuario lo pida explícitamente.** No hagas push:
eso lo confirma el usuario aparte, incluso si ya pidió los commits.

## Resumen en una línea

Ticket completo → tabla de verificación ítem por ítem → build + tests reales (no
supuestos) → cobertura explicada, no inflada → `CLAUDE.md` actualizado → comentario de
Linear mostrado antes de postear → commits agrupados sin push. Si el usuario solo
pidió "revisar", parate después de la tabla de verificación y preguntá cómo seguir.
