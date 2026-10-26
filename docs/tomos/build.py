#!/usr/bin/env python3
"""Genera los tomos de documentación de Movo en PDF.

Flujo: Markdown (contenido/) + PlantUML (diagramas/) -> HTML (plantillas/) -> PDF (WeasyPrint).

Uso:
    python3 docs/tomos/build.py            # todos los tomos
    python3 docs/tomos/build.py tomo-1     # un tomo
    python3 docs/tomos/build.py --html     # solo HTML intermedio (más rápido para revisar)

Requisitos: pandoc, Java 11+ (PlantUML), graphviz, Python con weasyprint, jinja2, pyyaml,
beautifulsoup4. Las fuentes Inter y JetBrains Mono tienen que estar instaladas en el sistema.
Ver README.md.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path

import jinja2
import yaml
from bs4 import BeautifulSoup

RAIZ = Path(__file__).resolve().parent
BUILD = RAIZ / "build"
SALIDA = RAIZ / "salida"
DIAG_SRC = RAIZ / "diagramas"
DIAG_OUT = BUILD / "diagramas"
DIAG_GEN = BUILD / "generados"
sys.path.insert(0, str(Path(__file__).resolve().parent / "herramientas"))
import seccionar  # noqa: E402

PLANTUML_JAR = Path(os.environ.get("PLANTUML_JAR", "/opt/tools/plantuml.jar"))
TEMA_PLANTUML = RAIZ / "estilos" / "plantuml-tema.iuml"

MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto",
         "septiembre", "octubre", "noviembre", "diciembre"]


def cargar_yaml(ruta: Path) -> dict:
    with open(ruta, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


# ─────────────────────────────── Diagramas ───────────────────────────────

def renderizar_diagramas() -> None:
    """Renderiza a SVG los .puml que cambiaron (o cuyo tema cambió) desde el último build."""
    DIAG_OUT.mkdir(parents=True, exist_ok=True)
    DIAG_GEN.mkdir(parents=True, exist_ok=True)
    # Diagramas no UML generados por script (mapas de procesos, etc.) y SVG hechos a mano.
    for gen in sorted(DIAG_SRC.glob("*.py")):
        subprocess.run([sys.executable, str(gen)], check=True, env={**os.environ, "DIAG_OUT": str(DIAG_OUT), "DIAG_GEN": str(DIAG_GEN)})
    for svg in sorted(DIAG_SRC.glob("*.svg")):
        (DIAG_OUT / svg.name).write_bytes(svg.read_bytes())
    tema = TEMA_PLANTUML.read_bytes()
    pendientes = []
    fuentes = []
    PARTES_DIR = DIAG_OUT.parent / "partes"
    PARTES_DIR.mkdir(parents=True, exist_ok=True)
    for fuente in sorted(list(DIAG_SRC.rglob("*.puml")) + list(DIAG_GEN.glob("*.puml"))):
        trozos = seccionar.partes(fuente.read_text(encoding="utf-8"), fuente.stem)
        if not trozos:
            fuentes.append(fuente)
            continue
        for n, (_, texto) in enumerate(trozos, 1):
            parte = PARTES_DIR / f"{fuente.stem}-{n}.puml"
            if not parte.exists() or parte.read_text(encoding="utf-8") != texto:
                parte.write_text(texto, encoding="utf-8")
            fuentes.append(parte)
    for fuente in fuentes:
        destino = DIAG_OUT / (fuente.stem + ".svg")
        sello = DIAG_OUT / (fuente.stem + ".hash")
        h = hashlib.sha1(tema + fuente.read_bytes()).hexdigest()
        if destino.exists() and sello.exists() and sello.read_text() == h:
            continue
        pendientes.append((fuente, sello, h))
    if not pendientes:
        return
    print(f"  PlantUML: {len(pendientes)} diagrama(s)")
    base = ["java", "-Djava.awt.headless=true", "-DPLANTUML_LIMIT_SIZE=16384", "-jar", str(PLANTUML_JAR),
            "-tsvg", "-charset", "UTF-8", "-o", str(DIAG_OUT)]
    # Gantt, WBS y mindmap usan <style> propio: el tema de skinparams no les aplica (y los rompe).
    propios = ("@startgantt", "@startwbs", "@startmindmap")
    con_tema = [f for f, _, _ in pendientes if not f.read_text(encoding="utf-8").lstrip().startswith(propios)]
    sin_tema = [f for f, _, _ in pendientes if f not in con_tema]
    salida = ""
    for lote, extra in ((con_tema, ["-config", str(TEMA_PLANTUML)]), (sin_tema, [])):
        if lote:
            r = subprocess.run(base + extra + [str(f) for f in lote], capture_output=True, text=True)
            salida += r.stdout + r.stderr
    errores = [l for l in salida.splitlines() if "rror" in l and "JAVA_TOOL_OPTIONS" not in l]
    for fuente, sello, h in pendientes:
        destino = DIAG_OUT / (fuente.stem + ".svg")
        if destino.exists() and b"Syntax Error" not in destino.read_bytes():
            sello.write_text(h)
        else:
            print(f"  ! error en {fuente.relative_to(RAIZ)}")
    if errores:
        print("\n".join("    " + e for e in errores[:20]))


# ─────────────────────────────── Markdown ───────────────────────────────

def md_a_html(md: str, prefijo: str = "", nivel_extra: int = 1) -> str:
    """Convierte Markdown (dialecto pandoc) a un fragmento HTML."""
    # ![Título](diagrama:nombre){.clase} -> imagen SVG renderizada desde diagramas/nombre.puml
    md = re.sub(r"\]\(diagrama:([\w\-]+)\)", r"](build/diagramas/\1.svg)", md)
    cmd = ["pandoc", "-f", "markdown+pipe_tables+grid_tables+fenced_divs+bracketed_spans"
           "+raw_html+implicit_figures+table_captions+smart",
           "-t", "html5", "--wrap=none", f"--shift-heading-level-by={nivel_extra}"]
    if prefijo:
        cmd.append(f"--id-prefix={prefijo}-")
    r = subprocess.run(cmd, input=md, capture_output=True, text=True, check=True)
    return r.stdout


def sin_rayas_largas(html: str) -> str:
    """Política de estilo del equipo: no se usan rayas (em dash) en los documentos."""
    html = html.replace(" — ", ", ").replace("—", "-")
    return html


def numerar(doc: dict, html: str, figuras: list, tablas: list) -> tuple[str, list]:
    """Numera secciones, figuras y tablas del documento y arma su lista de secciones."""
    soup = BeautifulSoup(html, "lxml")
    cuerpo = soup.body or soup
    # Las tablas convertidas desde Word llegan con todas las filas dentro de <thead>: una cabecera más alta
    # que la página no se puede partir y se pierde. Solo la primera fila es cabecera; el resto pasa al cuerpo.
    for tabla in cuerpo.find_all("table"):
        # Con anchos de columna declarados se fija el layout: el contenido largo se parte en vez de ensanchar la tabla.
        if tabla.find("colgroup") and "caso" not in tabla.get("class", []):
            tabla["class"] = tabla.get("class", []) + ["fija"]
        primera = tabla.find(["th", "td"])
        if primera and primera.get_text(strip=True) == "Variable":
            tabla["class"] = tabla.get("class", []) + ["vars"]
        cab = tabla.find("thead")
        filas = cab.find_all("tr", recursive=False) if cab else []
        if len(filas) > 1:
            cuerpo_t = tabla.find("tbody") or tabla.new_tag("tbody")
            if cuerpo_t.parent is None:
                tabla.append(cuerpo_t)
            for fila in reversed(filas[1:]):
                for c in fila.find_all("th", recursive=False):
                    c.name = "td"
                cuerpo_t.insert(0, fila.extract())
    secciones = []
    n2 = n3 = 0
    nueva_pagina = doc.get("secciones_en_pagina_nueva", True)
    for h in cuerpo.find_all(["h2", "h3"]):
        titulo = h.get_text(" ", strip=True)
        clases = h.get("class", [])
        if not h.get("id"):
            h["id"] = f"{doc['id']}-{hashlib.md5(titulo.encode()).hexdigest()[:8]}"
        if "unnumbered" in clases:
            h["data-marcador"] = titulo
            if h.name == "h2" and nueva_pagina:
                h["class"] = clases + ["nueva-pagina"]
            continue
        if h.name == "h2":
            n2 += 1
            n3 = 0
            numero = f"{doc['n']}.{n2}"
            if nueva_pagina and n2 > 0:
                h["class"] = clases + ["nueva-pagina"]
        else:
            if n2 == 0:
                continue
            n3 += 1
            numero = f"{doc['n']}.{n2}.{n3}"
        span = soup.new_tag("span", attrs={"class": "num"})
        span.string = numero
        h.insert(0, span)
        h["data-marcador"] = f"{numero} {titulo}"
        nivel = 2 if h.name == "h2" else 3
        if nivel == 3 and not doc.get("indice_nivel_3", True):
            continue
        secciones.append({"nivel": nivel, "numero": numero, "titulo": titulo, "ancla": h["id"]})

    nf = 0
    for fig in cuerpo.find_all("figure"):
        nf += 1
        numero = f"{doc['n']}.{nf}"
        cap = fig.find("figcaption")
        titulo = cap.get_text(" ", strip=True) if cap else ""
        if not cap:
            cap = soup.new_tag("figcaption")
            fig.append(cap)
        cap.clear()
        rot = soup.new_tag("span", attrs={"class": "rotulo"})
        rot.string = f"Figura {numero}. "
        cap.append(rot)
        cap.append(titulo)
        fig["id"] = fig.get("id") or f"{doc['id']}-fig-{nf}"
        figuras.append({"numero": numero, "titulo": titulo, "ancla": fig["id"]})
        img = fig.find("img")
        if img:
            if img.get("alt") == titulo:
                img["alt"] = titulo
            # pandoc deja las clases `{.apaisada}` en la imagen; el CSS las necesita en la figura
            propias = {"apaisada", "pagina-completa", "borde", "sin-corte"}
            heredadas = [c for c in img.get("class", []) if c in propias]
            if heredadas:
                fig["class"] = fig.get("class", []) + heredadas

    nt = 0
    for cap in cuerpo.find_all("caption"):
        nt += 1
        numero = f"{doc['n']}.{nt}"
        titulo = cap.get_text(" ", strip=True)
        cap.clear()
        rot = soup.new_tag("span", attrs={"class": "rotulo"})
        rot.string = f"Tabla {numero}. "
        cap.append(rot)
        cap.append(titulo)
        tabla = cap.find_parent("table")
        tabla["id"] = tabla.get("id") or f"{doc['id']}-tab-{nt}"
        tablas.append({"numero": numero, "titulo": titulo, "ancla": tabla["id"]})

    salida = "".join(str(c) for c in cuerpo.contents)
    return salida, secciones


# ─────────────────────────────── Tomos ───────────────────────────────

def fecha_larga(f: dt.date) -> str:
    return f"{MESES[f.month - 1]} de {f.year}"


def fecha_dia(f: dt.date) -> str:
    return f"{f.day} de {MESES[f.month - 1]} de {f.year}"


def entorno() -> jinja2.Environment:
    """Entorno de Jinja con los conversores de unidades del diseño: mm(px) a mm y pt(px) a pt (A4 = 794 px de ancho)."""
    env = jinja2.Environment(loader=jinja2.FileSystemLoader(RAIZ / "plantillas"), autoescape=False)
    env.globals["mm"] = lambda n: f"{n * 210 / 794:.3f}mm"
    env.globals["pt"] = lambda n: f"{n * 0.75:g}pt"
    # Tapa: el prototipo está a escala 2 px = 1 mm (A4 = 420 x 594 px).
    env.globals["u"] = lambda n: f"{n * 0.5:g}mm"
    env.globals["ufs"] = lambda n: f"{n * 0.5 * 72 / 25.4:.2f}pt"
    return env


def es_oscuro(color: str) -> bool:
    """Luminancia relativa baja (mismo criterio que el prototipo de tapas): el texto pasa a blanco."""
    h = color.lstrip("#")
    h = "".join(c * 2 for c in h) if len(h) == 3 else h
    r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    lin = [v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4 for v in (r, g, b)]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2] < 0.4


def contexto_tapa(tomo: dict, cfg: dict, proyecto: dict, puntos: str) -> dict:
    """Variables comunes de la tapa (plano de tapa dura y páginas de la edición digital)."""
    t = cfg["tapa"]
    oscuro = es_oscuro(t["color"])
    palabras = tomo["titulo"].split(" ", 1)
    return dict(
        tapa=t, oscuro=oscuro, puntos=puntos,
        fg="#FFFFFF" if oscuro else "#0A0A0B",
        fg2="rgba(255,255,255,.72)" if oscuro else "rgba(10,10,11,.76)",
        linea="rgba(255,255,255,.16)" if oscuro else "rgba(10,10,11,.16)",
        pill_fg="#0A0A0B" if t["acento"].upper() == "#C6F24A" else "#FFFFFF",
        t1=palabras[0], t2=palabras[1] if len(palabras) > 1 else "",
        romano=tomo["numero_largo"].replace("Tomo ", ""),
        logo_marca="movo-simbolo-claro.svg" if oscuro else "movo-marca.svg",
        logo_utn="utn-frc-extendido-claro.svg" if oscuro else "utn-frc-extendido.svg",
        logo_isi="isi-reducido-claro.svg" if oscuro else "isi-reducido.svg")


def construir_tapa(tomo: dict, cfg: dict, proyecto: dict, paginas: int, destino: Path) -> Path:
    """PDF de tapa dura de un tomo: contratapa + lomo + tapa en un solo plano, a escala real y con solapas.

    El lomo se calcula con las páginas del tomo (doble faz: dos páginas por hoja). Las medidas del cartón dependen
    de quien encuaderne y se configuran en `tapa:` de config/tomos.yaml.
    """
    from weasyprint import HTML

    sys.path.insert(0, str(RAIZ / "herramientas"))
    import motivos

    t = cfg["tapa"]
    hojas = (paginas + 1) // 2
    lomo = max(round(hojas * t["hojas_grosor_mm"] + t["lomo_extra_mm"]), 6)
    canto, ranura, solapa = t["canto_mm"], t["ranura_mm"], t["solapa_mm"]
    panel_w = 210 + canto
    ancho = 2 * solapa + 2 * panel_w + 2 * ranura + lomo
    alto = 2 * solapa + 297 + 2 * canto
    # Los puntos de la tapa se extienden sobre el canto y la solapa; 1 px de diseño = 0.5 mm.
    puntos = motivos.puntos_tapa((canto + solapa) * 2, 210 + canto + solapa, 297 + canto + solapa, t["acento"])
    ctx = contexto_tapa(tomo, cfg, proyecto, puntos)
    ctx.update(p=proyecto, tomo=tomo, lomo=lomo, ancho=ancho, alto=alto, panel_w=panel_w, canto=canto,
               ranura=ranura, solapa=solapa, hojas=hojas, paginas=paginas, titulo_lomo=tomo["titulo"])
    html = entorno().get_template("tapa.html.j2").render(**ctx)
    ruta_html = RAIZ / f"_{tomo['id']}-tapa.html"
    ruta_html.write_text(html, encoding="utf-8")
    destino.mkdir(parents=True, exist_ok=True)
    pdf = destino / f"Movo - {tomo['numero_largo']} - Tapa dura.pdf"
    HTML(filename=str(ruta_html), base_url=str(RAIZ)).write_pdf(str(pdf))
    ruta_html.unlink()
    print(f"  lomo {lomo} mm ({paginas} páginas, {hojas} hojas); plano {ancho:g} x {alto:g} mm")
    return pdf


def preparar_documento(tomo_dir: Path, ref: dict, n: int, figuras: list, tablas: list) -> dict:
    doc_dir = tomo_dir / ref["dir"]
    meta = cargar_yaml(doc_dir / "meta.yaml")
    doc = {**meta, "n": n, "id": ref["dir"].split("-", 1)[-1]}
    doc.setdefault("titulo_corto", doc["titulo"])
    doc["ancla"] = f"doc-{doc['id']}-inicio"
    partes = []
    for archivo in meta.get("archivos") or sorted(p.name for p in doc_dir.glob("*.md")):
        if isinstance(archivo, dict) and "gen" in archivo:
            # Generador con argumentos: {gen: herramientas/gen_tema.py, args: [ep01]}
            r = subprocess.run([sys.executable, str(RAIZ / archivo["gen"]), *map(str, archivo.get("args", []))],
                               capture_output=True, text=True, cwd=RAIZ)
            if r.returncode != 0:
                raise SystemExit(f"Falló el generador {archivo['gen']}:\n{r.stderr}")
            partes.append(md_a_html(r.stdout, prefijo=doc["id"]))
            continue
        ruta = doc_dir / archivo
        if ruta.suffix == ".py":
            # Contenido generado a partir de datos (por ejemplo, historias de usuario).
            r = subprocess.run([sys.executable, str(ruta)], capture_output=True, text=True, cwd=RAIZ)
            if r.returncode != 0:
                raise SystemExit(f"Falló el generador {ruta}:\n{r.stderr}")
            partes.append(md_a_html(r.stdout, prefijo=doc["id"]))
        elif ruta.suffix == ".html":
            # Fragmento HTML ya limpio (por ejemplo, informes convertidos desde .docx): sin pasar por pandoc.
            partes.append(ruta.read_text(encoding="utf-8"))
        else:
            partes.append(md_a_html(ruta.read_text(encoding="utf-8"), prefijo=doc["id"]))
    html = sin_rayas_largas("\n".join(partes))
    doc["html"], doc["secciones"] = numerar(doc, html, figuras, tablas)
    for campo in ("introduccion", "audiencia"):
        if doc.get(campo):
            doc[f"{campo}_html"] = sin_rayas_largas(md_a_html(doc[campo], nivel_extra=0))
    return doc


EDICIONES = ("digital", "impresa")


def construir_tomo(tomo_id: str, cfg: dict, proyecto: dict, solo_html: bool, ediciones=EDICIONES) -> list[Path]:
    """Genera un tomo en una o dos ediciones: digital (simple faz, con tapa y contratapa) e impresa (doble faz)."""
    tomo = next(t for t in cfg["tomos"] if t["id"] == tomo_id)
    tomo_dir = RAIZ / "contenido" / tomo_id
    figuras, tablas = [], []
    refs = [r for r in tomo["documentos"] if (tomo_dir / r["dir"] / "meta.yaml").exists()]
    faltantes = [r["dir"] for r in tomo["documentos"] if r not in refs]
    if faltantes:
        print(f"  (sin contenido todavía: {', '.join(faltantes)})")
    documentos = [preparar_documento(tomo_dir, ref, i + 1, figuras, tablas)
                  for i, ref in enumerate(refs)]
    tomo = {**tomo, "presentacion_html": sin_rayas_largas(md_a_html(tomo.get("presentacion", ""), nivel_extra=0))}
    fecha = dt.date.fromisoformat(cfg.get("fecha_entrega")) if cfg.get("fecha_entrega") else dt.date.today()
    sys.path.insert(0, str(RAIZ / "herramientas"))
    import motivos
    palabras = tomo["titulo"].split(" ", 1)
    ctx_tapa = contexto_tapa(tomo, cfg, proyecto, motivos.puntos_tapa(0, 210, 297, cfg["tapa"]["acento"])) if cfg.get("tapa") else {}
    BUILD.mkdir(exist_ok=True)
    generados = []
    for ed in ediciones:
        html = entorno().get_template("tomo.html.j2").render(
            **{**ctx_tapa, "t1": palabras[0], "t2": palabras[1] if len(palabras) > 1 else "",
               "romano": tomo["numero_largo"].replace("Tomo ", "")},
            edicion=ed, p=proyecto, tomo=tomo, todos_tomos=cfg["tomos"], documentos=documentos,
            figuras=figuras, tablas=tablas, indices_figuras_tablas=cfg.get("indices_figuras_tablas", False),
            fecha_larga=fecha_larga(fecha), fecha_mes=fecha_larga(fecha), fecha_dia=fecha_dia(fecha),
            puntos_interior=motivos.puntos_interior())
        ruta_html = RAIZ / f"_{tomo_id}.html"  # en la raíz para que las rutas relativas resuelvan
        ruta_html.write_text(html, encoding="utf-8")
        (BUILD / f"{tomo_id}-{ed}.html").write_text(html, encoding="utf-8")
        if solo_html:
            generados.append(ruta_html)
            continue
        from weasyprint import HTML  # import diferido: tarda en cargar
        # La edición digital queda en salida/ (la que se abre y se sube); la impresa en salida/impresa/.
        destino = SALIDA if ed == "digital" else SALIDA / "impresa"
        destino.mkdir(parents=True, exist_ok=True)
        pdf = destino / tomo["archivo"]
        doc = HTML(filename=str(ruta_html), base_url=str(RAIZ)).render()
        doc.write_pdf(str(pdf))
        ruta_html.unlink()
        print(f"  edición {ed}: {len(doc.pages)} páginas")
        generados.append(pdf)
        if ed == "impresa" and cfg.get("tapa"):
            construir_tapa(tomo, cfg, proyecto, len(doc.pages), destino)
    return generados


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    solo_html = "--html" in sys.argv
    # --edicion digital | impresa (por defecto, las dos)
    ediciones = EDICIONES
    for i, a in enumerate(sys.argv):
        if a == "--edicion" and i + 1 < len(sys.argv):
            ediciones = (sys.argv[i + 1],)
            args = [x for x in args if x != sys.argv[i + 1]]
        elif a.startswith("--edicion="):
            ediciones = (a.split("=", 1)[1],)
    for e in ediciones:
        if e not in EDICIONES:
            raise SystemExit(f"Edición desconocida: {e} (digital | impresa)")
    cfg = cargar_yaml(RAIZ / "config" / "tomos.yaml")
    proyecto = cargar_yaml(RAIZ / "config" / "proyecto.yaml")
    renderizar_diagramas()
    for t in cfg["tomos"]:
        if args and t["id"] not in args:
            continue
        print(f"→ {t['id']}: {t['titulo']}")
        for salida in construir_tomo(t["id"], cfg, proyecto, solo_html, ediciones):
            print(f"  {salida.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
