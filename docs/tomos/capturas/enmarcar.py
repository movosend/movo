#!/usr/bin/env python3
"""Pone una captura del simulador dentro de un marco de iPhone.

Uso: enmarcar.py entrada.png salida.png --marco marco-iphone.png [--pantalla X,Y,W,H] [--radio PX]

Si el marco tiene la pantalla transparente, el área se detecta sola: es la región transparente
conectada al centro de la imagen. Con --pantalla se indica a mano (en píxeles del marco).
"""
import argparse

from PIL import Image, ImageDraw


def detectar_pantalla(marco: Image.Image) -> tuple[int, int, int, int]:
    alfa = marco.getchannel("A")
    ancho, alto = marco.size
    if alfa.getpixel((ancho // 2, alto // 2)) > 8:
        raise SystemExit("El centro del marco no es transparente: indicá --pantalla X,Y,W,H")
    caja = alfa.point(lambda v: 255 if v <= 8 else 0).getbbox()
    # El bbox de lo transparente incluye el exterior si el marco tiene esquinas transparentes;
    # se acota a la región interior buscando desde el centro hacia los bordes.
    cx, cy = ancho // 2, alto // 2
    izq = der = cx
    while izq > 0 and alfa.getpixel((izq - 1, cy)) <= 8:
        izq -= 1
    while der < ancho - 1 and alfa.getpixel((der + 1, cy)) <= 8:
        der += 1
    arr = cx
    aba = cy
    while arr > 0 and alfa.getpixel((cx, arr - 1)) <= 8:
        arr -= 1
    while aba < alto - 1 and alfa.getpixel((cx, aba + 1)) <= 8:
        aba += 1
    _ = caja
    return izq, arr, der - izq + 1, aba - arr + 1


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("entrada")
    p.add_argument("salida")
    p.add_argument("--marco", required=True)
    p.add_argument("--pantalla", help="X,Y,W,H en píxeles del marco")
    p.add_argument("--radio", type=int, default=0, help="radio de las esquinas de la pantalla (px del marco)")
    a = p.parse_args()

    marco = Image.open(a.marco).convert("RGBA")
    if a.pantalla:
        x, y, w, h = (int(v) for v in a.pantalla.split(","))
    else:
        x, y, w, h = detectar_pantalla(marco)
    captura = Image.open(a.entrada).convert("RGBA").resize((w, h), Image.LANCZOS)
    radio = a.radio or int(min(w, h) * 0.085)
    mascara = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mascara).rounded_rectangle((0, 0, w - 1, h - 1), radius=radio, fill=255)
    lienzo = Image.new("RGBA", marco.size, (0, 0, 0, 0))
    lienzo.paste(captura, (x, y), mascara)
    lienzo.alpha_composite(marco)
    lienzo.save(a.salida)
    print(f"Pantalla {w}x{h} en ({x},{y}); marco {marco.size[0]}x{marco.size[1]}")


if __name__ == "__main__":
    main()
