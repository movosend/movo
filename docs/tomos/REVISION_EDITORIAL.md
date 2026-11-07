# Plan de implementación de la revisión editorial

## Objetivo

Reducir repeticiones dentro de los tres tomos y entre ellos, conservando el contenido mínimo de las dos guías de la cátedra y la trazabilidad necesaria para evaluar el proyecto. El desarrollo detallado de las historias de usuario queda en el Tomo II.

## Cambios

1. **Estudio Inicial (Tomo I).** Indicar que registra la propuesta de agosto y señalar los cambios materiales del producto final. Sintetizar la descripción de los procesos y la enumeración funcional; remitir el detalle vigente a los Tomos II y III.
2. **Backlog inicial (Tomo I).** Conservar el mapa, el corte MVP, las estimaciones y el listado de las 32 historias iniciales. Reemplazar las fichas con criterios por una tabla y explicar cómo evolucionó el backlog. Los criterios originales quedan en el anexo digital; el detalle vigente de las 50 historias y su trazabilidad permanece en el Tomo II.
3. **Informes de sprint (Tomo I).** Conservar objetivo, compromiso estimado, resultado, métricas con análisis, retrospectiva, acciones, repriorización y riesgos. Abreviar las tablas de tickets y la reproducción de artefactos ya desarrollados en el Tomo II. Guardar el texto íntegro original en `anexos/sprints/`.
4. **DER (Tomo II).** Conservar los diagramas, tablas y enumerados; limitar el diccionario impreso a claves y campos de negocio relevantes. Guardar el diccionario completo generado como anexo digital.
5. **Decisiones de diseño (Tomo II).** Imprimir una síntesis de las DD y conservar completas las que explican asignación, vigencia del pago y resolución de disputas (DD-037, DD-050 y DD-056). Mantener el registro íntegro como anexo digital, separado de los ADR de arquitectura que exige la guía.
6. **Manuales (Tomo III).** Dejar decisiones, responsabilidades y excepciones en Procedimientos; dejar navegación y acciones de pantalla en Usuario, con referencias entre ambos. Conservar las capturas útiles para realizar tareas.

## Validación

- Comparar la cobertura resultante con las guías de `requirements/`.
- Verificar que permanezcan las 32 historias iniciales y las 50 historias detalladas vigentes.
- Comprobar referencias cruzadas, cifras y reglas de negocio que cambiaron.
- Regenerar los tres tomos y revisar la paginación si el entorno de compilación está disponible.

## Resultado de la edición

Los anexos digitales están en `anexos/` y se empaquetan en `entrega/Movo - Anexos digitales.zip` para acompañar los PDF. Los originales de los nueve informes de sprint se preservaron sin cambios. El Tomo II conserva el desarrollo detallado de las 50 historias vigentes; el Tomo I conserva la tabla de las 32 historias iniciales y sus criterios originales en el anexo.

| PDF digital | Antes | Después | Reducción |
|---|---:|---:|---:|
| Tomo I | 274 páginas | 216 páginas | 58 |
| Tomo II | 378 páginas | 318 páginas | 60 |
| Tomo III | 136 páginas | 136 páginas | 0 |
| **Total** | **788 páginas** | **670 páginas** | **118** |

Las dos ediciones de los tres tomos y los planos de tapa dura se regeneraron. Se revisaron visualmente la tabla del backlog inicial y los diagramas y el inventario del DER; la compilación HTML y PDF terminó sin errores. `git diff --check`, la lectura de los metadatos YAML y la integridad del ZIP de anexos también pasaron.
