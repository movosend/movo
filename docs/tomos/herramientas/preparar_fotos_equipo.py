#!/usr/bin/env python3
"""Prepara las fotos del equipo para la página "El equipo" de los tomos.

Toma las fotos del sitio institucional (movo-institucional/public/team-pictures), las pasa a blanco y negro con un
poco de contraste y las recorta en 4:5 desde arriba, igual que la sección del equipo del sitio. Salida: assets/equipo/*.jpg.

Uso: preparar_fotos_equipo.py <carpeta con las fotos>
"""
import sys
from pathlib import Path

from PIL import Image, ImageEnhance, ImageOps

# archivo de origen -> (archivo de salida, centro horizontal del recorte, 0 a 1)
FOTOS = {
    "alena.png": ("alena.jpg", 0.5),
    "juancruz.jpeg": ("juancruz.jpg", 0.6),
    "lucas.jpeg": ("lucas.jpg", 0.5),
    "pedro.jpeg": ("pedro.jpg", 0.5),
    "tomas.jpeg": ("tomas.jpg", 0.5),
}
DESTINO = Path(__file__).resolve().parent.parent / "assets" / "equipo"
ANCHO, ALTO = 640, 800


def main() -> None:
    origen = Path(sys.argv[1])
    DESTINO.mkdir(parents=True, exist_ok=True)
    for nombre, (salida, cx) in FOTOS.items():
        im = ImageOps.exif_transpose(Image.open(origen / nombre)).convert("RGB")
        ancho = min(im.width, round(im.height * ANCHO / ALTO))
        alto = round(ancho * ALTO / ANCHO)
        x = min(max(round(im.width * cx - ancho / 2), 0), im.width - ancho)
        im = im.crop((x, 0, x + ancho, alto)).resize((ANCHO, ALTO), Image.LANCZOS)
        im = ImageEnhance.Contrast(ImageOps.grayscale(im)).enhance(1.05)
        im.save(DESTINO / salida, "JPEG", quality=88, optimize=True)
        print(f"{nombre} -> {salida}")


if __name__ == "__main__":
    main()
