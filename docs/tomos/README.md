# Tomos de documentación · Proyecto Final Movo

Fuente de los tres tomos de la entrega final (UTN FRC · ISI · Proyecto Final 2026 · 5K3 · Grupo 27):

| Tomo | Contenido |
| --- | --- |
| I · Documentación de Proyecto | Ficha para Biblioteca, Estudio Inicial, Plan de Proyecto, artefactos del Sprint 0, informes de sprint, impacto ambiental, paper, póster y retrospectiva |
| II · Documentación de Producto | Épicas e historias de usuario con su trazabilidad (criterios, secuencia, casos de prueba), clases, patrones, estados, DER y arquitectura |
| III · Manuales | Manual de Procedimientos, Manual de Instalación y Operación, Manual de Usuario |

La documentación se escribe en Markdown y se maqueta para impresión (A4, simple faz) con
HTML + CSS Paged Media. Los diagramas UML se escriben en PlantUML y comparten un tema común.

## Estructura

```
config/proyecto.yaml     datos únicos del equipo (carátulas, ficha, encabezados)
config/tomos.yaml        manifiesto: qué documentos van en cada tomo y en qué orden
contenido/<tomo>/<doc>/  meta.yaml (título, historial, introducción, audiencia) + .md
diagramas/*.puml         diagramas UML (PlantUML) · *.py generadores de diagramas no UML
estilos/print.css        hoja de estilos de impresión (marca Movo aplicada de forma sutil)
estilos/plantuml-tema.iuml  tema común de todos los diagramas
plantillas/tomo.html.j2  carátula, ficha, índices y separadores de documento
datos/                   datos estructurados (historias de usuario, casos de prueba)
```

## Generar los PDF

Requisitos: `pandoc`, Java 11+, `graphviz`, las fuentes Inter y JetBrains Mono instaladas, el
jar de PlantUML (`PLANTUML_JAR`, por defecto `/opt/tools/plantuml.jar`) y
`pip install weasyprint jinja2 pyyaml beautifulsoup4 lxml`.

```bash
python3 docs/tomos/build.py            # los tres tomos -> docs/tomos/salida/*.pdf
python3 docs/tomos/build.py tomo-2     # un solo tomo
python3 docs/tomos/build.py --html     # solo el HTML intermedio (build/), más rápido
```

## Convenciones de escritura

- `#` dentro de un documento es una sección numerada (1.1), `##` una subsección (1.1.1); `###` en
  adelante no se numera. `{.unnumbered}` evita la numeración.
- Figuras: `![Título de la figura.](diagrama:nombre)` toma `diagramas/nombre.puml` (o el SVG
  generado). Las figuras y las tablas con `: Título` se numeran solas y entran en los índices.
- Bloques: `::: nota`, `::: importante`, `::: pendiente` (marca lo que falta completar).
- No se usan rayas (—): el build las reemplaza.

## Estado de la entrega (cierre del Sprint 8)

- Los tres tomos compilan: `python3 docs/tomos/build.py [tomo-1|tomo-2|tomo-3]`. Salida en `salida/` (ignorada por Git).
- Resultados de pruebas: ejecutar las suites con reporter JSON/JUnit y consolidar con `herramientas/ingerir_resultados.py paquete=ruta ...`.
- Manual de Usuario: las capturas son marcos pendientes; al guardar `assets/capturas/M-NN.png` (o `W-NN.png`) el build las incluye solas.
- Pendientes de contenido: ADRs finales, Impacto Ambiental, video del póster, fechas de hitos por confirmar.
