#!/usr/bin/env python3
"""Enmarca las capturas móviles del simulador sin tocar los originales.

Lee `assets/capturas/M-NN.png` y escribe `assets/capturas-marco/M-NN.png`. El Manual de Usuario usa
la versión enmarcada si existe (ver `herramientas/gen_manual_usuario.py`) y, si no, el original. La carpeta de
salida no se commitea (ver `.gitignore`): se regenera con este script.

Uso: enmarcar_todas.py [M-14 M-15 ...] [--forzar]
Sin códigos enmarca todas las que cambiaron desde la última vez; con --forzar, todas.
"""
import argparse
import subprocess
import sys
from pathlib import Path

AQUI = Path(__file__).resolve().parent
ORIGINALES = AQUI.parent / "assets" / "capturas"
DESTINO = AQUI.parent / "assets" / "capturas-marco"
MARCO = AQUI / "marco_iphone.png"

# El marco trae la isla dinámica dibujada dentro del área transparente, así que la detección automática
# de `enmarcar.py` arranca debajo de ella y deforma la captura. La pantalla real del marco es exactamente
# del tamaño de una captura del simulador (1206x2622); el radio es el de la esquina de esa pantalla.
PANTALLA = "57,48,1206,2622"
RADIO = "184"


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("codigos", nargs="*", help="códigos a enmarcar (por defecto, todos los M-NN)")
    p.add_argument("--forzar", action="store_true", help="regenerar aunque la enmarcada esté al día")
    a = p.parse_args()

    if not MARCO.exists():
        sys.exit(f"Falta el marco: {MARCO}")
    DESTINO.mkdir(parents=True, exist_ok=True)

    if a.codigos:
        origen = [ORIGINALES / f"{c}.png" for c in a.codigos]
    else:
        origen = sorted(ORIGINALES.glob("M-*.png"))

    hechas = 0
    for src in origen:
        if not src.exists():
            sys.exit(f"No existe la captura {src}")
        dst = DESTINO / src.name
        if not a.forzar and dst.exists() and dst.stat().st_mtime >= max(src.stat().st_mtime, MARCO.stat().st_mtime):
            continue
        subprocess.run(
            [sys.executable, str(AQUI / "enmarcar.py"), str(src), str(dst), "--marco", str(MARCO),
             "--pantalla", PANTALLA, "--radio", RADIO],
            check=True, stdout=subprocess.DEVNULL,
        )
        hechas += 1
    print(f"Enmarcadas {hechas} de {len(origen)} en {DESTINO}")


if __name__ == "__main__":
    main()
