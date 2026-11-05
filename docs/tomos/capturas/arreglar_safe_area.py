#!/usr/bin/env python3
"""Corrige las barras negras de las safe areas de una captura del simulador.

Cuando la pantalla no pinta bajo la barra de estado o bajo el indicador de inicio, el simulador
deja bandas negras arriba y abajo. Este script las detecta (filas negras en los bordes), las
rellena con el color de la fila contigua y vuelve a dibujar la barra de estado (isla, hora,
señal, wifi, batería) en oscuro, más el indicador de inicio.

Uso: arreglar_safe_area.py captura.png [...]   (sobrescribe; no hace nada si no hay bandas)
"""
import sys

from PIL import Image, ImageDraw, ImageFont

UMBRAL = 12


def negro(px) -> bool:
    return max(px[:3]) <= UMBRAL


def banda_superior(im) -> int:
    w, h = im.size
    n = 0
    while n < h // 4 and negro(im.getpixel((3, n))) and negro(im.getpixel((w - 4, n))):
        n += 1
    return n


def banda_inferior(im) -> int:
    w, h = im.size
    n = 0
    while n < h // 4 and negro(im.getpixel((3, h - 1 - n))) and negro(im.getpixel((w - 4, h - 1 - n))):
        n += 1
    return n


def barra_estado(d, w, sup):
    k = w / 920  # las medidas están tomadas sobre 920 px de ancho
    c = (10, 10, 11)
    cy = int(74 * k * sup / (141 * k)) if False else int(74 * k)
    fuente = None
    for f in ("/usr/share/fonts/opentype/inter/Inter-SemiBold.otf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
        try:
            fuente = ImageFont.truetype(f, int(46 * k))
            break
        except OSError:
            pass
    d.text((int(146 * k), cy), "9:41", fill=c, font=fuente, anchor="mm")
    # señal: 4 barras crecientes
    for i in range(4):
        alto = int((12 + 8 * i) * k)
        x = int((660 + 15 * i) * k)
        d.rounded_rectangle((x, cy + int(14 * k) - alto, x + int(9 * k), cy + int(14 * k)), radius=int(2 * k), fill=c)
    # wifi: tres arcos y un punto
    wx, wy = int(740 * k), cy + int(14 * k)
    for r in (22, 14):
        d.arc((wx - int(r * k), wy - int(r * k) - int(6 * k), wx + int(r * k), wy + int(r * k) - int(6 * k)),
              215, 325, fill=c, width=int(5 * k))
    d.ellipse((wx - int(5 * k), wy - int(9 * k), wx + int(5 * k), wy + int(1 * k)), fill=c)
    # batería
    bx = int(780 * k)
    d.rounded_rectangle((bx, cy - int(14 * k), bx + int(50 * k), cy + int(14 * k)), radius=int(8 * k), outline=c, width=int(3 * k))
    d.rounded_rectangle((bx + int(5 * k), cy - int(9 * k), bx + int(40 * k), cy + int(9 * k)), radius=int(4 * k), fill=c)
    d.rounded_rectangle((bx + int(53 * k), cy - int(5 * k), bx + int(57 * k), cy + int(5 * k)), radius=int(2 * k), fill=c)


def arreglar(ruta: str) -> str:
    im = Image.open(ruta).convert("RGB")
    w, h = im.size
    sup, inf = banda_superior(im), banda_inferior(im)
    if sup < 8 and inf < 8:
        return "sin bandas"
    orig = im.copy()
    d = ImageDraw.Draw(im)
    if sup >= 8:
        color = orig.getpixel((3, sup + 2))
        d.rectangle((0, 0, w, sup + 3), fill=color)
        # Isla dinámica: se conserva del original (pastilla negra centrada)
        isla = (int(w * 0.345), int(sup * 0.22), int(w * 0.655), int(sup * 0.82))
        d.rounded_rectangle(isla, radius=(isla[3] - isla[1]) // 2, fill=(0, 0, 0))
        barra_estado(d, w, sup)
    if inf >= 8:
        color = orig.getpixel((3, h - inf - 3))
        d.rectangle((0, h - inf - 1, w, h), fill=color)
        bw, bh = int(w * 0.36), max(6, int(h * 0.0024))
        cx, y = w // 2, h - int(inf * 0.35)
        d.rounded_rectangle((cx - bw // 2, y - bh // 2, cx + bw // 2, y + bh // 2), radius=bh // 2, fill=(10, 10, 11))
    im.save(ruta)
    return f"arreglada (arriba {sup}px, abajo {inf}px)"


if __name__ == "__main__":
    for r in sys.argv[1:]:
        print(r, arreglar(r))
