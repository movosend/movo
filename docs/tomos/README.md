# Tomos de documentación · Proyecto Final Movo

Fuente de los tres tomos de la entrega final (UTN FRC · ISI · Proyecto Final 2026 · 5K3 · Grupo 27):

| Tomo | Contenido |
| --- | --- |
| I · Documentación de Proyecto | Ficha para Biblioteca, Estudio Inicial, Plan de Proyecto, artefactos del Sprint 0, informes de sprint, impacto ambiental, paper, póster y retrospectiva |
| II · Documentación de Producto | Épicas e historias de usuario con su trazabilidad (criterios, secuencia, casos de prueba), clases, patrones, estados, DER y arquitectura |
| III · Manuales | Manual de Procedimientos, Manual de Instalación y Operación, Manual de Usuario |

La documentación se escribe en Markdown y se maqueta con HTML + CSS Paged Media (A4) en dos ediciones del mismo contenido:

- **Digital** (`salida/`, `entrega/`): la misma paginación de libro que la impresa, con la tapa como primera página
  (seguida de la guarda en blanco) y la contratapa como última. Se abre en pantalla y se sube al campus.
- **Impresa** (`salida/impresa/`, `entrega/impresa/`): sin tapa ni contratapa en el PDF, que van aparte como plano de
  tapa dura (contratapa + lomo + tapa). Es la que va a encuadernación.

Las dos son a doble faz: márgenes espejados, número de página en el borde exterior, separadores y secciones principales
en página impar y hojas en blanco donde corresponde. El tomo se arma como un libro (estructura editorial):

1. Tapa y guarda (solo digital) · 2. Anteportada · 3. Verso de la anteportada (la obra en tres tomos) · 4. Portada ·
5. Página de créditos (derechos, edición, créditos, cómo citar, alcance y marcas) · 6. Ficha para Biblioteca (Tomo I) ·
7. Presentación e índice general · 8. Documentos, cada uno con su separador · 9. El equipo (fotos y texto, cierre) ·
10. Colofón · 11. Contratapa (solo digital, en página par).

El texto de la página del equipo y las fotos salen de `config/proyecto.yaml` (`equipo:` y `foto:` de cada integrante). Las
fotos se prepararon con `herramientas/preparar_fotos_equipo.py` a partir de las del sitio institucional.

## Estructura

```
config/proyecto.yaml     datos únicos del equipo (carátulas, ficha, encabezados)
config/tomos.yaml        manifiesto: qué documentos van en cada tomo y en qué orden
contenido/<tomo>/<doc>/  meta.yaml (título, historial, introducción, audiencia) + .md
diagramas/*.puml         diagramas UML (PlantUML) · *.py generadores de diagramas no UML
estilos/print.css        hoja de estilos de impresión (marca Movo aplicada de forma sutil)
estilos/plantuml-tema.iuml  tema común de todos los diagramas
plantillas/tomo.html.j2  anteportada, portada, datos de edición, ficha, índice, separadores y colofón
plantillas/_portadas.css.j2  estilos de esas páginas (medidas del diseño en px, convertidas a mm/pt)
plantillas/tapa.html.j2  tapa dura: contratapa + lomo + tapa a escala real
herramientas/motivos.py  motivos de puntos (SVG) de las carátulas y las tapas
datos/                   datos estructurados (historias de usuario, casos de prueba)
```

## Generar los PDF

Requisitos: `pandoc`, Java 11+, `graphviz`, las fuentes Inter y JetBrains Mono instaladas, el
jar de PlantUML (`PLANTUML_JAR`, por defecto `/opt/tools/plantuml.jar`) y
`pip install weasyprint jinja2 pyyaml beautifulsoup4 lxml`.

```bash
python3 docs/tomos/build.py            # los tres tomos, en las dos ediciones, y las tapas -> docs/tomos/salida/
python3 docs/tomos/build.py --edicion digital   # solo una edición (la mitad de tiempo)
python3 docs/tomos/build.py tomo-2     # un solo tomo
python3 docs/tomos/build.py --html     # solo el HTML intermedio (build/), más rápido
```

## Tapa dura

`build.py` genera, con la edición impresa, `Movo - Tomo N - Tapa dura.pdf`: un solo plano con contratapa, lomo y tapa
a escala real, con la solapa que se dobla hacia adentro y marcas de plegado. El ancho del lomo se calcula con las
páginas del tomo (doble faz, 0,1 mm por hoja más 2 mm de holgura). Color, canto del cartón, ranura y solapa están
en `tapa:` de `config/tomos.yaml`: son valores de partida, **confirmarlos con quien encuaderne** antes de imprimir.
El índice de figuras y de tablas se omite (`indices_figuras_tablas: false`); las figuras y tablas siguen numeradas.

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
- Pendientes de contenido: fechas de hitos por confirmar.
