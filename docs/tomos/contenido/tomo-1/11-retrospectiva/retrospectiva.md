::: pendiente
**Borrador para validar por el equipo.** La guía de la cátedra pide una reflexión honesta sobre el proceso completo, y esa reflexión es del equipo. Este texto es una propuesta redactada a partir de la evidencia que los propios Informes de Sprint dejaron por escrito (insights, action items, riesgos y notas de cierre). Cada integrante debería revisarlo, corregirlo y, sobre todo, agregar lo que la documentación no captura. Se debe retirar este recuadro al aprobarlo.
:::

# Tres Decisiones que Resultaron Bien

## Validar contra el proveedor real antes de construir

Cada integración crítica se precedió de un *spike* corto contra el servicio real, no contra su documentación: la restricción del CVV en el cobro con tarjetas guardadas y el hecho de que la comisión entera se descuente en la captura parcial no figuraban en la documentación de Mercado Pago, y se descubrieron en pruebas del Sprint 7 (MOVO-100 y MOVO-305), antes de escribir las migraciones. El mismo patrón se repitió con el canal de tiempo real (MOVO-200, con un ADR y una prueba de concepto ejecutada contra un servidor real) y con el motor de precios (consultas reales a la API de la Secretaría de Energía y simulación para calibrar el umbral de demanda). **Por qué funcionó:** cada rediseño evitado costó una conversación y no una reescritura.

## Aislar a cada proveedor externo detrás de una interfaz con implementación simulada

SMS (ADR-012), email (ADR-016), geocodificación (ADR-014), rutas y KYC se acceden a través de interfaces, con una implementación simulada por defecto en desarrollo, pruebas e integración continua y la real activada por configuración. **Por qué funcionó:** el desarrollo y la CI no dependieron de cuentas de pago ni de la disponibilidad de terceros (riesgos R10 y R11 del Plan de Proyecto), el frente móvil pudo avanzar contra *mocks* mientras los proveedores se configuraban, y la demostración puede activar el servicio real cambiando una variable de entorno.

## Dejar el razonamiento por escrito y no reescribir el pasado

Las decisiones de diseño quedaron registradas como ADRs que no se editan una vez aceptados: cuando el TTL del refresh token pasó de 7 a 90 días se creó un ADR nuevo (ADR-013) en lugar de modificar el ADR-004, y los comentarios de cierre de cada ticket documentaron los desvíos respecto del enunciado. **Por qué funcionó:** el equipo pudo reconstruir *por qué* algo era como era (incluso semanas después y con otra persona a cargo), y el Plan, los informes y el código se pudieron contrastar sin ambigüedad.

# Tres Cosas que Haríamos Diferente

## Atacar antes los bloqueos de terceros con un plazo máximo

La integración con Mercado Pago estuvo detenida más de 45 días a la espera de la respuesta del soporte del proveedor; el bloqueo se destrabó probando otra configuración de cuentas de prueba, no con la respuesta del ticket. **Haríamos diferente:** fijar desde el inicio un plazo máximo de espera y, vencido, atacar el bloqueo con un spike propio; y concentrar el frente más riesgoso del proyecto (pagos) antes en el calendario,.

## Tener una única fuente para los ADRs desde el primer día

Los ADRs vivieron en tres lugares (Drive, `docs/` del repositorio y el `CLAUDE.md` raíz), con numeración que colisionó en más de una ocasión y con ADRs que existieron solo en uno de los lugares. **Haríamos diferente:** una sola fuente de verdad en el repositorio, con el número reservado al abrir el ticket (no al escribir el ADR) y la actualización de su resumen como parte de la Definition of Done.

## Planificar el sprint completo y verificar en dispositivo y entorno reales a medida que se construye

El alcance creció de forma pronunciada durante los sprints (+237% en el Sprint 5 y +111% en el Sprint 6 respecto de lo planificado), el cierre se concentró en el último día del ciclo y las verificaciones que dependían de infraestructura o de un dispositivo físico (el handshake entre dos teléfonos, el seguimiento en Android, los *deep-links* de navegación) se acumularon como «pendientes declarados» en los tickets. **Haríamos diferente:** pasar por el Planning todo trabajo que entra al ciclo, asignar cada verificación en dispositivo como una tarea con responsable y fecha, y no cargar como Story Points el tiempo académico (que distorsionó la velocity del Sprint 6).

# Recomendaciones para Futuros Equipos

1. **Empiecen por el riesgo, no por lo cómodo.** Identifiquen la integración externa más incierta (para nosotros, pagos y KYC) y hagan un spike contra el servicio real en las primeras semanas, con plazo de espera acotado.
2. **Diseñen los mocks como ciudadanos de primera clase.** Un proveedor simulado explícito (con el tipo importado de la librería compartida, no redefinido localmente) destraba al resto del equipo, pero necesita un paso de cableado con dueño; si no, el tipo local miente sobre el contrato real.
3. **Un action item sin ticket ni responsable único no se cumple.** Los incumplidos de nuestras retrospectivas eran tareas transversales sin issue propio; conviértanlos en tickets en el mismo momento.
4. **Medir sirve si la métrica refleja la realidad.** Nuestro *Defect Rate* dio 0 en un sprint con al menos tres defectos reales corregidos dentro de otros tickets. Acuerden desde el principio qué cuenta como defecto y cómo se etiqueta.
5. **Documenten mientras construyen.** Los comentarios de cierre de los tickets y los informes de sprint fueron la mejor fuente para armar esta documentación; reconstruir el razonamiento al final es mucho más caro.
6. **Cuiden los secretos.** Una política de información sensible solo vale si se verifica: en uno de los sprints se detectaron credenciales de producción publicadas en comentarios de un ticket; revisen periódicamente qué se publica en las herramientas de gestión.
7. **Usen la IA con revisión humana.** Nuestras herramientas de IA aceleraron la escritura de código y documentación, pero cada cambio pasó por revisión de Pull Request: el control humano fue lo que sostuvo la calidad.
