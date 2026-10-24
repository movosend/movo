#!/usr/bin/env python3
"""Genera los mapas de procesos (no UML) en SVG con el estilo común de los tomos.

Un mapa de procesos tiene tres capas (estratégicos, operativos, de apoyo); los operativos se
dibujan como cadena de valor (chevrons). Se ejecuta desde build.py antes de renderizar PlantUML.
"""
import os
from pathlib import Path
from xml.sax.saxutils import escape

INK, INK6, INK4, INK2, INK1, INK05, LIME = "#0A0A0B", "#3A3A40", "#8A8A93", "#D9D9DE", "#F1F1F3", "#F8F8F9", "#C6F24A"
FONT = "Inter, sans-serif"


def texto(x, y, s, size=11, weight=400, color=INK, anchor="middle", spacing=0, extra=""):
    return (f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" '
            f'fill="{color}" text-anchor="{anchor}" letter-spacing="{spacing}" {extra}>{escape(s)}</text>')


def caja(x, y, w, h, titulo, sub, borde=INK, fondo="#FFFFFF", grosor=1.2):
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="7" fill="{fondo}" stroke="{borde}" stroke-width="{grosor}"/>']
    out.append(texto(x + w / 2, y + h / 2 - 3 if sub else y + h / 2 + 4, titulo, 11.5, 600))
    if sub:
        for i, linea in enumerate(sub.split("\n")):
            out.append(texto(x + w / 2, y + h / 2 + 13 + i * 12, linea, 9.2, 400, INK6))
    return "\n".join(out)


def chevron(x, y, w, h, titulo, destacado=False, sub=""):
    p = 18
    pts = f"{x},{y} {x + w - p},{y} {x + w},{y + h / 2} {x + w - p},{y + h} {x},{y + h} {x + p},{y + h / 2}"
    fondo = LIME if destacado else INK1
    out = [f'<polygon points="{pts}" fill="{fondo}" stroke="{INK}" stroke-width="1.1" stroke-linejoin="round"/>']
    out.append(texto(x + w / 2 + 4, y + h / 2 + (0 if sub else 4), titulo, 11.5, 600))
    if sub:
        out.append(texto(x + w / 2 + 4, y + h / 2 + 15, sub, 8.6, 400, INK6))
    return "\n".join(out)


def banda(y, h, etiqueta, fondo=INK05):
    return (f'<rect x="40" y="{y}" width="700" height="{h}" rx="9" fill="{fondo}" stroke="{INK2}" stroke-width="1"/>'
            + texto(56, y + 20, etiqueta.upper(), 8.6, 600, INK6, "start", 1.4))


def mapa(nombre, estrategicos, operativos, apoyo, izq="EMISOR", der="RECEPTOR", alto_op=100, filas_apoyo=1):
    alto_ap = 92 if filas_apoyo == 1 else 160
    H = 30 + 120 + 14 + alto_op + 14 + alto_ap + 20
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="780" height="{H}" viewBox="0 0 780 {H}">']
    y = 20
    s.append(banda(y, 120, "Procesos estratégicos"))
    n = len(estrategicos)
    w = (700 - 32 - (n - 1) * 14) / n
    for i, (t, sub) in enumerate(estrategicos):
        s.append(caja(56 + i * (w + 14), y + 34, w, 70, t, sub))
    y += 120 + 14
    s.append(banda(y, alto_op, "Procesos operativos (cadena de valor)", "#FFFFFF"))
    n = len(operativos)
    w = (700 - 32 - (n - 1) * 4) / n
    for i, op in enumerate(operativos):
        t, dest = op[0], op[1]
        sub = op[2] if len(op) > 2 else ""
        s.append(chevron(56 + i * (w + 4), y + 32, w, alto_op - 46, t, dest, sub))
    s.append(texto(22, y + alto_op / 2, izq, 9.5, 600, INK, "middle", 2, f'transform="rotate(-90 22 {y + alto_op / 2})"'))
    s.append(texto(758, y + alto_op / 2, der, 9.5, 600, INK, "middle", 2, f'transform="rotate(90 758 {y + alto_op / 2})"'))
    y += alto_op + 14
    s.append(banda(y, alto_ap, "Procesos de apoyo"))
    por_fila = (len(apoyo) + filas_apoyo - 1) // filas_apoyo
    w = (700 - 32 - (por_fila - 1) * 12) / por_fila
    for i, (t, sub) in enumerate(apoyo):
        fila, col = divmod(i, por_fila)
        s.append(caja(56 + col * (w + 12), y + 32 + fila * 66, w, 54, t, sub, INK4, "#FFFFFF", 1))
    s.append("</svg>")
    (Path(os.environ.get("DIAG_OUT", Path(__file__).parent)) / (nombre + ".svg")).write_text("\n".join(s), encoding="utf-8")


if __name__ == "__main__":
    # Estado actual (AS-IS) de la logística P2P informal, Estudio Inicial §3.
    mapa("mapa-procesos-asis",
         [("Gestión de confianza", "red de contactos · boca a boca"),
          ("Coordinación", "acuerdo verbal de condiciones"),
          ("Gestión del riesgo", "asumido individualmente")],
         [("Solicitud", True), ("Retiro", False), ("Envío y traslado", False), ("Entrega", True)],
         [("Comunicación", "WhatsApp · Facebook"), ("Pago informal", "efectivo · transferencia"),
          ("Reputación", "boca a boca · referencias"), ("Resolución de disputas", "ninguna formal")])

    # Mapa global de procesos de Movo (TO-BE), Estudio Inicial §4.3.
    mapa("mapa-procesos-tobe",
         [("Identidad y confianza", "P1 Registro y KYC · P2 Reputación\nP3 Validación del transportista"),
          ("Precios y mercado", "P7 Motor de precios y subastas"),
          ("Gestión del riesgo", "P13 Hold de fondos · P16 Disputas\ny reembolsos")],
         [("Solicitud", True, "P5 · P6"), ("Asignación", False, "P7 · P8"), ("Retiro", False, "P11 · P12"),
          ("Traslado", False, "P9 · P10"), ("Entrega", True, "P11 · P12 · P14")],
         [("Notificaciones", "push en eventos clave"), ("Chat del envío", "por envío, en tiempo real"),
          ("Pagos", "P13 Hold · P14 Split · P15 Efectivo"), ("Administración", "panel, disputas, soporte")],
         alto_op=104)
