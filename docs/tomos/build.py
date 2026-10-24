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
    # Diagramas no UML generados por script (mapas de procesos, etc.) y SVG hechos a mano.
    for gen in sorted(DIAG_SRC.glob("*.py")):
        subprocess.run([sys.executable, str(gen)], check=True, env={**os.environ, "DIAG_OUT": str(DIAG_OUT)})
    for svg in sorted(DIAG_SRC.glob("*.svg")):
        (DIAG_OUT / svg.name).write_bytes(svg.read_bytes())
    tema = TEMA_PLANTUML.read_bytes()
    pendientes = []
    for fuente in sorted(DIAG_SRC.rglob("*.puml")):
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


def construir_tomo(tomo_id: str, cfg: dict, proyecto: dict, solo_html: bool) -> Path:
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
    env = jinja2.Environment(loader=jinja2.FileSystemLoader(RAIZ / "plantillas"), autoescape=False)
    fecha = dt.date.fromisoformat(cfg.get("fecha_entrega")) if cfg.get("fecha_entrega") else dt.date.today()
    html = env.get_template("tomo.html.j2").render(
        p=proyecto, tomo=tomo, todos_tomos=cfg["tomos"], documentos=documentos,
        figuras=figuras, tablas=tablas, fecha_larga=fecha_larga(fecha))
    BUILD.mkdir(exist_ok=True)
    ruta_html = RAIZ / f"_{tomo_id}.html"  # en la raíz para que las rutas relativas resuelvan
    ruta_html.write_text(html, encoding="utf-8")
    (BUILD / f"{tomo_id}.html").write_text(html, encoding="utf-8")
    if solo_html:
        return ruta_html
    from weasyprint import HTML  # import diferido: tarda en cargar
    SALIDA.mkdir(exist_ok=True)
    pdf = SALIDA / tomo["archivo"]
    HTML(filename=str(ruta_html), base_url=str(RAIZ)).write_pdf(str(pdf))
    ruta_html.unlink()
    return pdf


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    solo_html = "--html" in sys.argv
    cfg = cargar_yaml(RAIZ / "config" / "tomos.yaml")
    proyecto = cargar_yaml(RAIZ / "config" / "proyecto.yaml")
    renderizar_diagramas()
    for t in cfg["tomos"]:
        if args and t["id"] not in args:
            continue
        print(f"→ {t['id']}: {t['titulo']}")
        salida = construir_tomo(t["id"], cfg, proyecto, solo_html)
        print(f"  {salida.relative_to(RAIZ)}")


if __name__ == "__main__":
    main()
