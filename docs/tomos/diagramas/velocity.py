#!/usr/bin/env python3
"""Velocity por sprint (Story Points completados según Linear), para el resumen de procesos del Tomo I."""
import os
from pathlib import Path

INK, INK6, INK4, INK2, INK1, LIME = "#0A0A0B", "#3A3A40", "#8A8A93", "#D9D9DE", "#F1F1F3", "#C6F24A"
FONT = "Inter, sans-serif"
# (sprint, SP completados, en curso)  ·  Serie del Informe del Sprint 7; Sprint 1 según el Informe del Sprint 2.
DATOS = [("Sprint 1", 22, False), ("Sprint 2", 95, False), ("Sprint 3", 121, False), ("Sprint 4", 106, False),
         ("Sprint 5", 80, False), ("Sprint 6", 135, False), ("Sprint 7", 150, False), ("Sprint 8", 82, True)]


def main() -> None:
    W, H, ml, mb, mt = 640, 250, 44, 34, 24
    ph = H - mb - mt
    mx = 160
    n = len(DATOS)
    bw = (W - ml - 16) / n
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">',
         '<defs><pattern id="r" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">'
         f'<rect width="6" height="6" fill="#FFFFFF"/><rect width="2.4" height="6" fill="{INK}"/></pattern></defs>']
    for v in range(0, mx + 1, 40):
        y = mt + ph - v / mx * ph
        s.append(f'<line x1="{ml}" y1="{y}" x2="{W - 10}" y2="{y}" stroke="{INK2}" stroke-width="0.6"/>')
        s.append(f'<text x="{ml - 6}" y="{y + 3}" font-family="{FONT}" font-size="8" fill="{INK4}" text-anchor="end">{v}</text>')
    pts = []
    for i, (nombre, v, en_curso) in enumerate(DATOS):
        x = ml + i * bw + bw * 0.18
        w = bw * 0.64
        h = v / mx * ph
        y = mt + ph - h
        fill = "url(#r)" if en_curso else (LIME if i == n - 2 else INK1)
        s.append(f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="3" fill="{fill}" stroke="{INK}" stroke-width="1"/>')
        s.append(f'<text x="{x + w / 2}" y="{y - 5}" font-family="JetBrains Mono, monospace" font-size="9" font-weight="600" fill="{INK}" text-anchor="middle">{v}{"*" if en_curso else ""}</text>')
        s.append(f'<text x="{x + w / 2}" y="{H - mb + 14}" font-family="{FONT}" font-size="8.6" fill="{INK6}" text-anchor="middle">{nombre}</text>')
        if not en_curso:
            pts.append((x + w / 2, y))
    s.append("</svg>")
    destino = Path(os.environ.get("DIAG_OUT", Path(__file__).parent)) / "velocity.svg"
    destino.write_text("\n".join(s), encoding="utf-8")


if __name__ == "__main__":
    main()
