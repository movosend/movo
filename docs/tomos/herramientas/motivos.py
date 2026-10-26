"""Motivos de puntos (halftone) de las carátulas y las tapas, como SVG.

El diseño original usa `radial-gradient` + `mask-image` para que los puntos se desvanezcan; WeasyPrint no
soporta `mask-image`, así que se dibujan los puntos uno a uno con la opacidad que da la máscara. Todas las
medidas están en las unidades del diseño (px del prototipo) y el `viewBox` las lleva a milímetros.
"""
from __future__ import annotations

import math


def _puntos(caja: tuple[float, float, float, float], paso: float, radio: float, centro: tuple[float, float],
            alcance: float, opacidad_max: float, recorte: tuple[float, float, float, float]) -> str:
    """Puntos en una grilla de `paso` dentro de `caja` (x0, y0, x1, y1), con opacidad decreciente desde `centro`."""
    x0, y0, x1, y1 = caja
    rx0, ry0, rx1, ry1 = recorte
    out = []
    j = 0
    while y0 + paso / 2 + j * paso <= y1:
        cy = y0 + paso / 2 + j * paso
        i = 0
        while x0 + paso / 2 + i * paso <= x1:
            cx = x0 + paso / 2 + i * paso
            i += 1
            if not (rx0 <= cx <= rx1 and ry0 <= cy <= ry1):
                continue
            d = math.hypot(cx - centro[0], cy - centro[1])
            a = opacidad_max * max(0.0, 1.0 - d / alcance)
            if a < 0.02:
                continue
            out.append(f'<circle cx="{cx:g}" cy="{cy:g}" r="{radio:g}" fill-opacity="{a:.2f}"/>')
        j += 1
    return "".join(out)


def puntos_interior(ancho_mm: float = 210, alto_mm: float = 105.8, color: str = "#0A0A0B") -> str:
    """Bloque lima de las carátulas internas (794 x 400 px): puntos en la esquina superior derecha."""
    w, h = 794, 400
    # Caja del prototipo: 440 x 440 con right/top = -40; máscara centrada al 85 % / 15 % que se apaga al 60 % del
    # radio hasta la esquina más lejana.
    caja = (w + 40 - 440, -40, w + 40, -40 + 440)
    centro = (caja[0] + 0.85 * 440, caja[1] + 0.15 * 440)
    lejos = max(math.hypot(centro[0] - x, centro[1] - y) for x in (caja[0], caja[2]) for y in (caja[1], caja[3]))
    svg = _puntos(caja, 16, 2.9, centro, 0.6 * lejos, 0.85, (0, 0, w, h))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{ancho_mm}mm" height="{alto_mm}mm" '
            f'fill="{color}">{svg}</svg>')


def puntos_tapa(margen_px: float, ancho_mm: float, alto_mm: float, color: str = "#0A0A0B") -> str:
    """Puntos de la portada de la tapa: esquina inferior derecha de una A4 de 420 x 594 px.

    `margen_px` extiende el dibujo más allá de la A4 (cantos y solapa del cartón) para que los puntos no
    se corten con un borde recto. El SVG cubre (-0, -0) a (420 + margen, 594 + margen) en la grilla de la A4.
    """
    w, h = 420, 594
    caja = (w + 40 - 420, h + 40 - 420, w + 40, h + 40)
    centro = (caja[0] + 0.75 * 420, caja[1] + 0.75 * 420)
    lejos = max(math.hypot(centro[0] - x, centro[1] - y) for x in (caja[0], caja[2]) for y in (caja[1], caja[3]))
    ancho_px, alto_px = w + margen_px, h + margen_px
    svg = _puntos(caja, 10, 1.8, centro, 0.62 * lejos, 1.0, (0, 0, ancho_px, alto_px))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {ancho_px:g} {alto_px:g}" width="{ancho_mm}mm" '
            f'height="{alto_mm}mm" fill="{color}">{svg}</svg>')
