#!/usr/bin/env python3
"""Genera el Manual de Usuario: inserta las capturas planificadas y arma el apéndice con su lista.

Cada `{{captura M-NN}}` del Markdown se reemplaza por un marco de captura. Si existe el archivo
`assets/capturas/M-NN.png` se usa la imagen real; si no, el marco muestra el código y la
descripción de qué capturar (estado de la pantalla y datos de prueba), que es la lista de trabajo
para tomar las capturas con el simulador.
"""
import html
import re
import sys
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parent.parent
CAPTURAS = {c["id"]: c for c in yaml.safe_load((RAIZ / "datos" / "capturas.yaml").read_text(encoding="utf-8"))["capturas"]}


def optimizada(origen: Path, codigo: str, alto_max: int) -> str:
    """Copia liviana de la captura (JPEG sobre fondo blanco) para el PDF; el original no se toca.

    Una captura enmarcada pesa ~650 KB y el manual lleva más de cien: sin esto el PDF supera los 60 MB.
    El alto máximo cubre la figura impresa a ~300 ppp.
    """
    from PIL import Image

    destino = RAIZ / "assets" / "capturas-opt" / f"{codigo}.jpg"
    if not destino.exists() or destino.stat().st_mtime < origen.stat().st_mtime:
        destino.parent.mkdir(parents=True, exist_ok=True)
        im = Image.open(origen).convert("RGBA")
        if im.height > alto_max:
            im = im.resize((round(im.width * alto_max / im.height), alto_max), Image.LANCZOS)
        fondo = Image.new("RGB", im.size, "#FFFFFF")
        fondo.paste(im, mask=im.split()[3])
        fondo.save(destino, "JPEG", quality=88, optimize=True)
    return f"assets/capturas-opt/{codigo}.jpg"


def figura(c: dict) -> str:
    img = RAIZ / "assets" / "capturas" / f"{c['id']}.png"
    # Las móviles usan la versión con marco de iPhone si existe (capturas/enmarcar_todas.py); si no, el original.
    enmarcada = RAIZ / "assets" / "capturas-marco" / f"{c['id']}.png"
    clase = "marco"
    if enmarcada.exists():
        clase = "marco con-marco"
        marco = f'<img src="{optimizada(enmarcada, c["id"], 1300)}" alt="{html.escape(c["titulo"])}">'
    elif img.exists():
        marco = f'<img src="{optimizada(img, c["id"], 1300)}" alt="{html.escape(c["titulo"])}">'
    else:
        marco = f'<div><span class="cod">{c["id"]}</span>Captura pendiente</div>'
    return (f'<figure class="cap"><div class="{clase}">{marco}</div><figcaption><b>{c["id"]} · {html.escape(c["titulo"])}</b>'
            f'<span>{html.escape(c["estado"])}</span></figcaption></figure>')


def galeria(ids: list[str]) -> str:
    """Agrupa capturas consecutivas en filas de 3 (móvil) o 2 (panel web)."""
    filas, actual = [], []
    for i in ids:
        c = CAPTURAS[i]
        tam = 2 if c["plataforma"] == "web" else 3
        if actual and (len(actual) >= tam or CAPTURAS[actual[0]]["plataforma"] != c["plataforma"]):
            filas.append(actual)
            actual = []
        actual.append(i)
    if actual:
        filas.append(actual)
    return "\n".join(
        f'<div class="galeria {"web" if CAPTURAS[f[0]]["plataforma"] == "web" else "movil"}">' + "".join(figura(CAPTURAS[i]) for i in f) + "</div>"
        for f in filas
    )


def main() -> None:
    base = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "contenido/tomo-3/03-manual-de-usuario/manual.md"
    txt = base.read_text(encoding="utf-8")
    usadas = []

    def sub(m: re.Match) -> str:
        ids = re.findall(r"[MW]-\d+", m.group(0))
        for i in ids:
            if i not in CAPTURAS:
                raise SystemExit(f"Captura inexistente en capturas.yaml: {i}")
        usadas.extend(ids)
        return "\n" + galeria(ids) + "\n"

    # Directivas consecutivas (separadas solo por líneas en blanco) forman una galería.
    txt = re.sub(r"(?:\{\{captura [MW]-\d+\}\}\s*)+", sub, txt)
    print(txt)
    print("\n# Apéndice: Lista de Capturas de Pantalla\n")
    print("Este apéndice lista las capturas que ilustran el manual, con la pantalla de la aplicación o del panel de la que se toma cada una y el estado que debe mostrar. Las que figuran como *pendientes* se reemplazan por la imagen real al tomarlas (archivo `M-NN.png` o `W-NN.png`). Las capturas de la aplicación móvil se toman con datos de prueba en el simulador, en tema claro y con la cuenta de prueba del rol que corresponda.\n")
    print("| Código | Pantalla o ruta | Qué debe mostrar | Estado |\n|------|--------------------|------------------------------------------|--------|")
    for i, c in CAPTURAS.items():
        estado = "Incluida" if (RAIZ / "assets" / "capturas" / f"{i}.png").exists() else "Pendiente"
        print(f"| `{i}` | `{c['pantalla']}` | {c['titulo']}: {c['estado']} | {estado} |")
    print("\n: Capturas de pantalla del manual.\n")
    faltan = sorted(set(CAPTURAS) - set(usadas))
    if faltan:
        sys.stderr.write(f"Capturas sin usar en el texto: {', '.join(faltan)}\n")


if __name__ == "__main__":
    main()
