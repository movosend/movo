# Anexos digitales de los tres tomos

Estos archivos acompañan los PDF digitales de `docs/tomos/entrega/` y se incluyen con la documentación y el código fuente en el pen drive. Conservan el detalle histórico o exhaustivo que se sintetizó en la edición impresa.

| Archivo | Contenido | Referencia en los tomos |
|---|---|---|
| `backlog-inicial-completo.md` | Las 32 historias estimadas en el Sprint 0 con sus criterios originales. | Tomo I, User Story Mapping y Backlog Inicial. |
| `sprints/` | Informes íntegros de los Sprints 0 a 8 y resumen original. | Tomo I, Informes de Sprint. |
| `diccionario-datos-completo.md` | Todas las tablas y columnas generadas desde Prisma. | Tomo II, Modelo de Datos (DER). |
| `decisiones-diseno-completas.md` | Las 35 DD con contexto, alternativas, decisión y consecuencias. | Tomo II, Registro de Decisiones de Diseño. |

El registro DD completo se actualiza con `herramientas/importar_dd.py`; ese comando también regenera la síntesis impresa. El diccionario completo se regenera desde `docs/tomos/` con `python3 herramientas/gen_der.py --completo > anexos/diccionario-datos-completo.md`.
