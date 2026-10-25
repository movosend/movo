# Resumen del Proceso

Esta sección sintetiza la evolución del proyecto sprint a sprint antes de presentar cada Informe de Sprint completo. Los datos provienen de los propios informes y del export de Linear del 24 de octubre de 2026.

## Los sprints en una tabla

| Sprint | Período | Ciclo en Linear | Issues | Velocity (SP) | Bugs (etiqueta) | Foco |
|---|---|---|--:|--:|--:|---|
| Sprint 0 | 29/06 al 12/07 | (previo a Linear) | – | – | – | Documentos de base: Working Agreement, gestión de la configuración, arquitectura, testing y backlog |
| Sprint 1 | 13/07 al 26/07 | Cycle 2 | 7 | 22 | 0 | Infraestructura como código, CI/CD y DER |
| Sprint 2 | 27/07 al 09/08 | Cycle 3 | 32 | 95 | 0 | Identidad: registro, OTP, KYC, autenticación y perfil |
| Sprint 3 | 10/08 al 23/08 | Cycle 4 | 41 | 121 | 2 | Creación de envíos, receptor, notificaciones |
| Sprint 4 | 24/08 al 06/09 | Cycle 5 | 42 | 106 | 2 | Marketplace de ofertas y reputación |
| Sprint 5 | 07/09 al 20/09 | Cycle 6 | 32 | 80 | 0 | Envío asignado: matching, evidencia y base de handshake y tracking |
| Sprint 6 | 21/09 al 04/10 | Cycle 7 | 48 | 135 | 3 | Handshake, tracking en vivo y ruta multi-parada |
| Sprint 7 | 05/10 al 18/10 | Cycle 8 | 59 | 150 | 2 | Pagos con Mercado Pago, penalidades, chat y panel de administración |
| Sprint 8 | 19/10 al 01/11 | Cycle 9 | 41 | 82* | 1 | Panel de administración, disputas, soporte y cierre de pagos |

: Resumen de los sprints del proyecto.

\* Sprint 8 en curso: puntos de las issues ya completadas al 24/10/2026. La velocity es la que informa Linear al cierre de cada ciclo; difiere en unos pocos puntos de la suma de las estimaciones por issue (los informes documentan esa diferencia). El valor del Sprint 1 corresponde al registrado en el Informe del Sprint 2.

::: nota
**Sobre la numeración de los ADR.** Cada informe cita los ADR con el número vigente al momento de escribirse. El 24/10/2026 el registro se depuró a 23 ADR: los números 001 a 015 no cambiaron; los ADR 017, 019, 020, 022, 024, 025, 035 y 040 pasaron a ser el 016 a 023, y el resto de las decisiones pasó al Registro de Decisiones de Diseño (DD) con su número original. La correspondencia completa está en el documento de Arquitectura del Tomo II.
:::

## Tendencia de la velocity

![Velocity por sprint: Story Points completados según Linear. El Sprint 8 está en curso.](diagrama:velocity)

La velocity pasó de 95 SP en el Sprint 2 a 121 SP en el Sprint 3, bajó a 106 SP en el Sprint 4 y a 80 SP en el Sprint 5, la más baja de la serie (−29,5% respecto del promedio de los dos sprints previos, al borde del umbral de alerta del 30% definido en el Plan de Proyecto; el informe aclara que no hay datos de horas disponibles para atribuir la caída a una causa concreta). Subió a 135 SP en el Sprint 6 (118 SP si se descuentan los registros de horas académicas cargados al final del ciclo, que inflan la métrica sin representar funcionalidad entregada) y a 150 SP en el Sprint 7, el máximo de la serie. El export de Linear no registra issues cancelados en ningún ciclo.

::: nota
La velocity depende de la calibración del Planning Poker y no es comparable entre equipos; en este proyecto se usa para detectar desvíos respecto del propio ritmo del equipo, con los umbrales de alerta definidos en el Plan de Proyecto. El análisis de cada sprint se encuentra en su informe.
:::

# Cómo leer los informes

Cada Informe de Sprint sigue la estructura exigida por la guía de la cátedra: objetivo del sprint (el valor a entregar), sprint backlog con estimación y capacidad asumida, resultado de la Sprint Review, métricas con análisis de tendencia, retrospectiva estructurada con el estado de los *action items* del sprint anterior, Product Backlog repriorizado y registro de riesgos actualizado. A partir del Sprint 2 se agregan los **artefactos de trazabilidad** de las historias del sprint: diagramas relevantes, ADR correspondiente, DER actualizado y casos de prueba con resultados de ejecución.

Los informes se presentan tal como se redactaron al cierre de cada sprint, con dos ajustes de compilación: se unificó el formato y se retiraron las portadas individuales. Las referencias a tickets (`MOVO-NNN`) corresponden a issues de Linear; sus historias de usuario se desarrollan en el Tomo II.
