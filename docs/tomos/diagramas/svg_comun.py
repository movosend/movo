"""Primitivas SVG compartidas por los generadores de gráficos de los tomos (no es un generador).

Paleta de la marca aplicada de forma sutil: tinta en grises y el lima como único acento, igual que
`velocity.py` y `mapas_procesos.py`. Los textos van en Inter y las cifras en JetBrains Mono.
"""
import os
from pathlib import Path
from xml.sax.saxutils import escape

INK, INK6, INK4, INK2, INK1, INK05, LIME = "#0A0A0B", "#3A3A40", "#8A8A93", "#D9D9DE", "#F1F1F3", "#F8F8F9", "#C6F24A"
LIME_SUAVE = "#EAFBC2"
# Escala semántica, solo donde el color codifica un nivel (riesgo, costo, problema): fondo suave + tinta fuerte.
ROJO, ROJO_SUAVE = "#B42318", "#F6B8B0"
NARANJA, NARANJA_SUAVE = "#B54708", "#FDDCB5"
AMBAR, AMBAR_SUAVE = "#8A6A00", "#FFF0B3"
VERDE, VERDE_SUAVE = "#3F6212", LIME_SUAVE
BLANCO = "#FFFFFF"
FONT = "Inter, sans-serif"
MONO = "JetBrains Mono, monospace"


# Los lienzos miden ~700 px y la caja de texto del tomo ~630 px: el SVG se reduce al imprimir. Este
# factor lleva los tamaños nominales de cada generador a un cuerpo legible en papel (~6 a 7 pt).
ESCALA_TEXTO = 1.15


def t(x, y, s, size=9, weight=400, color=INK, anchor="middle", mono=False, extra=""):
    """Texto; `s` admite saltos de línea (\\n) que se apilan cada 1,25 × size."""
    size = round(size * ESCALA_TEXTO, 2)
    fam = MONO if mono else FONT
    lineas = str(s).split("\n")
    out = []
    for i, linea in enumerate(lineas):
        out.append(f'<text x="{x:.1f}" y="{y + i * size * 1.25:.1f}" font-family="{fam}" font-size="{size}" '
                   f'font-weight="{weight}" fill="{color}" text-anchor="{anchor}" {extra}>{escape(linea)}</text>')
    return "\n".join(out)


def rect(x, y, w, h, fill=BLANCO, stroke=INK, sw=1, rx=4, extra=""):
    return (f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" fill="{fill}" '
            f'stroke="{stroke}" stroke-width="{sw}" {extra}/>')


def linea(x1, y1, x2, y2, color=INK, sw=1, dash="", extra=""):
    d = f'stroke-dasharray="{dash}"' if dash else ""
    return (f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{color}" '
            f'stroke-width="{sw}" {d} {extra}/>')


def flecha_defs(color=INK, ident="fl"):
    return (f'<marker id="{ident}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" '
            f'orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="{color}"/></marker>')


def flecha(x1, y1, x2, y2, color=INK, sw=1.1, dash="", ident="fl"):
    return linea(x1, y1, x2, y2, color, sw, dash, f'marker-end="url(#{ident})"')


def camino(d, color=INK, sw=1.1, dash="", ident="fl", fill="none"):
    dd = f'stroke-dasharray="{dash}"' if dash else ""
    mk = f'marker-end="url(#{ident})"' if ident else ""
    return f'<path d="{d}" fill="{fill}" stroke="{color}" stroke-width="{sw}" {dd} {mk}/>'


def circulo(cx, cy, r, fill=INK, stroke=INK, sw=1):
    return f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>'


def rayado_defs(ident="ray", color=INK, fondo=BLANCO):
    return (f'<pattern id="{ident}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
            f'<rect width="6" height="6" fill="{fondo}"/><rect width="1.6" height="6" fill="{color}"/></pattern>')


def num(v, dec=0):
    """Número con formato argentino: 1.234,5."""
    s = f"{v:,.{dec}f}"
    return s.replace(",", "§").replace(".", ",").replace("§", ".")


def guardar(nombre, w, h, cuerpo, defs=""):
    svg = [f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{w}" height="{h}" viewBox="0 0 {w} {h}">',
           f'<rect width="{w}" height="{h}" fill="{BLANCO}"/>']
    if defs:
        svg.append(f"<defs>{defs}</defs>")
    svg.extend(cuerpo if isinstance(cuerpo, list) else [cuerpo])
    svg.append("</svg>")
    destino = Path(os.environ.get("DIAG_OUT", Path(__file__).parent)) / f"{nombre}.svg"
    destino.write_text("\n".join(svg), encoding="utf-8")
