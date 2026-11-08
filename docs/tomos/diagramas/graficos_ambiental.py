#!/usr/bin/env python3
"""Gráficos del Informe de Impacto Ambiental (Tomo I).

Todas las cifras salen del propio informe (`contenido/tomo-1/03-impacto-ambiental`) y las
coordenadas del mapa, del catálogo del spike (`docs/or-tools/vrptw_prototype.py`). El mapa recalcula
las distancias al segmento con la misma proyección que el spike, para que las etiquetas coincidan.
"""
import base64
import math
import urllib.request
from pathlib import Path

from svg_comun import (NARANJA_SUAVE, ROJO, BLANCO, INK, INK05, INK1, INK2, INK4, INK6, LIME, LIME_SUAVE, camino, circulo,
                       flecha_defs, guardar, linea, num, rayado_defs, rect, t)

# ───────────────────────── A · Escala: infraestructura frente a un envío ─────────────────────────


def escala() -> None:
    W, H = 780, 262
    x0, x1 = 262, 620  # eje logarítmico de 0,001 a 100 kgCO₂e
    lo, hi = -3, 2

    def X(v):
        return x0 + (math.log10(v) - lo) / (hi - lo) * (x1 - x0)

    filas = [
        ("Desvío del transportista, OFFER-102", "+0,04 km", 0.010, None, INK1),
        ("Desvío del transportista, OFFER-101", "+0,60 km", 0.149, None, INK1),
        ("Infraestructura completa, un año", "dev + prod, según utilización", 2.7, 10.8, INK2),
        ("Viaje dedicado en auto", "141,63 km", 35.20, None, INK1),
        ("Evitado por un envío que lo reemplaza", "caso del spike", 35.05, 35.19, LIME),
    ]
    s = []
    top, paso = 30, 40
    for e in range(lo, hi + 1):
        x = X(10 ** e)
        s.append(linea(x, top - 8, x, top + paso * len(filas) - 8, INK2, 0.6))
        s.append(t(x, top + paso * len(filas) + 6, num(10 ** e, max(0, -e)), 8, color=INK4, mono=True))
    s.append(t((x0 + x1) / 2, top + paso * len(filas) + 22, "kgCO₂e (escala logarítmica)", 8.4, color=INK6))
    for i, (nombre, sub, a, b, fill) in enumerate(filas):
        y = top + i * paso
        s.append(t(x0 - 12, y + 7, nombre, 9.2, 600, anchor="end"))
        s.append(t(x0 - 12, y + 19, sub, 8, color=INK6, anchor="end"))
        if b is None:
            s.append(rect(x0, y, X(a) - x0, 20, fill, INK, 1, 3))
            s.append(t(X(a) + 6, y + 14, num(a, 3 if a < 1 else 2), 9, 600, anchor="start", mono=True))
        else:
            if i == 2:  # rango por utilización: cota inferior sólida, el resto rayado
                s.append(rect(x0, y, X(a) - x0, 20, fill, INK, 1, 3))
                s.append(rect(X(a), y, X(b) - X(a), 20, "url(#ray)", INK, 1, 0))
                s.append(t(X(b) + 6, y + 14, f"{num(a, 1)} a {num(b, 1)}", 9, 600, anchor="start", mono=True))
            else:
                s.append(rect(x0, y, X(b) - x0, 20, fill, INK, 1, 3))
                s.append(t(X(b) + 6, y + 14, f"≈ {num(b, 1)}", 9, 600, anchor="start", mono=True))
    # Lectura: un envío evita entre 3,2 y 13 veces lo que emite la infraestructura en un año
    ya, yb, xb = top + 2 * paso + 10, top + 4 * paso + 10, 688
    s.append(camino(f"M{xb - 6},{ya} L{xb},{ya} L{xb},{yb} L{xb - 6},{yb}", INK6, 1, "", None))
    s.append(t(xb + 8, (ya + yb) / 2 - 4, "×3,2 a ×13", 9, 700, INK, "start", True))
    s.append(t(xb + 8, (ya + yb) / 2 + 9, "un envío frente\na un año de\ninfraestructura", 7.8, 400, INK6, "start"))
    guardar("ia-escala", W, H, s, rayado_defs("ray", INK4))


# ───────────────────────── B · Mapa del corredor del spike ─────────────────────────

ORIGEN = ("Córdoba Capital", -31.4167, -64.1833)
DESTINO = ("Villa María", -32.4075, -63.2403)
OFERTAS = [  # id, recorrido, retiro (lat, lon), entrega (lat, lon), pasa el prefiltro
    ("OFFER-101", "Córdoba → Oncativo", (-31.4250, -64.1870), (-31.9139, -63.6817), True),
    ("OFFER-102", "Oliva → Villa María", (-32.0416, -63.5698), (-32.4075, -63.2403), True),
    ("OFFER-103", "Carlos Paz → Cosquín", (-31.4241, -64.4978), (-31.2444, -64.4658), False),
    ("OFFER-104", "Río Cuarto → Villa María", (-33.1230, -64.3492), (-32.4075, -63.2403), False),
]
MAX_DESVIO_KM = 15.0


def _dist_segmento(p, a, b):
    """Misma proyección equirectangular que `point_to_segment_distance_km` del spike."""
    kx = 111.32 * math.cos(math.radians((a[0] + b[0]) / 2))
    ky = 110.574
    bx, by = (b[1] - a[1]) * kx, (b[0] - a[0]) * ky
    px, py = (p[1] - a[1]) * kx, (p[0] - a[0]) * ky
    tt = max(0.0, min(1.0, (px * bx + py * by) / (bx * bx + by * by)))
    return math.hypot(px - tt * bx, py - tt * by)


# Fondo del mapa: tiles de OpenStreetMap (© colaboradores de OpenStreetMap, ODbL), en Web Mercator. Se
# descargan una sola vez y quedan en `diagramas/mapas/osm/`, versionados, para que el build no dependa de
# la red (política de uso de tile.openstreetmap.org: pocas descargas, User-Agent identificable y atribución).
ZOOM = 8
TILES_DIR = Path(__file__).parent / "mapas" / "osm"
TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
USER_AGENT = "movo-tomos/1.0 (documentacion academica UTN FRC; +https://github.com/movosend/movo)"


def _merc(lat, lon, z=ZOOM):
    """Píxel global de Web Mercator para el zoom `z` (tiles de 256 px)."""
    n = 256 * 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def _tile(x, y, z=ZOOM):
    """Tile en escala de grises (el mapa es contexto; el color queda para el corredor y las ofertas)."""
    ruta = TILES_DIR / f"{z}-{x}-{y}.png"
    gris = TILES_DIR / f"{z}-{x}-{y}-gris.png"
    if not gris.exists():
        if not ruta.exists():
            TILES_DIR.mkdir(parents=True, exist_ok=True)
            req = urllib.request.Request(TILE_URL.format(z=z, x=x, y=y), headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=30) as r:
                ruta.write_bytes(r.read())
        from PIL import Image  # solo hace falta la primera vez, para generar la versión en gris

        Image.open(ruta).convert("L").save(gris, optimize=True)
    return base64.b64encode(gris.read_bytes()).decode()


def corredor() -> None:
    W, H = 700, 500
    lon0, lat0, lon1, lat1 = -64.72, -31.05, -62.80, -33.32  # encuadre del mapa (NO y SE)
    mx0, my0 = 10, 10  # esquina del panel del mapa en el lienzo
    gx0, gy0 = _merc(lat0, lon0)
    gx1, gy1 = _merc(lat1, lon1)
    k = (H - 2 * my0) / (gy1 - gy0)  # escala del lienzo por píxel de Mercator
    mw = mx0 + (gx1 - gx0) * k  # borde derecho del mapa

    def P(lat, lon):
        gx, gy = _merc(lat, lon)
        return mx0 + (gx - gx0) * k, my0 + (gy - gy0) * k

    lat_c = (ORIGEN[1] + DESTINO[1]) / 2
    esc = 256 * 2 ** ZOOM / (40075.017 * math.cos(math.radians(lat_c))) * k  # px por km en el centro

    def th(x, y, texto, size, weight, color, anchor="start", mono=False):
        """Texto con halo blanco, legible sobre el mapa."""
        halo = 'stroke="#FFFFFF" stroke-width="3.4" stroke-linejoin="round"'
        return [t(x, y, texto, size, weight, "#FFFFFF", anchor, mono, halo), t(x, y, texto, size, weight, color, anchor, mono)]

    a, b = (ORIGEN[1], ORIGEN[2]), (DESTINO[1], DESTINO[2])
    ax, ay = P(*a)
    bx, by = P(*b)
    s = ['<clipPath id="mapa"><rect x="%.1f" y="%.1f" width="%.1f" height="%.1f" rx="6"/></clipPath>'
         % (mx0, my0, mw - mx0, H - 2 * my0)]
    s.append('<g clip-path="url(#mapa)">')
    tam = 256 * k
    for tx in range(int(gx0 // 256), int(gx1 // 256) + 1):
        for ty in range(int(gy0 // 256), int(gy1 // 256) + 1):
            x, y = mx0 + (tx * 256 - gx0) * k, my0 + (ty * 256 - gy0) * k
            s.append(f'<image x="{x:.2f}" y="{y:.2f}" width="{tam + 0.6:.2f}" height="{tam + 0.6:.2f}" '
                     f'preserveAspectRatio="none" xlink:href="data:image/png;base64,{_tile(tx, ty)}"/>')
    # Velo blanco: el mapa queda de contexto y el corredor y las ofertas, en primer plano.
    s.append(f'<rect x="{mx0}" y="{my0}" width="{mw - mx0:.1f}" height="{H - 2 * my0}" fill="#FFFFFF" fill-opacity="0.30"/>')
    # Franja de ±15 km alrededor del segmento: un trazo grueso de puntas redondas.
    s.append(f'<line x1="{ax:.1f}" y1="{ay:.1f}" x2="{bx:.1f}" y2="{by:.1f}" stroke="{LIME}" stroke-opacity="0.45" '
             f'stroke-width="{2 * MAX_DESVIO_KM * esc:.1f}" stroke-linecap="round"/>')
    s.append("</g>")
    s.append(rect(mx0, my0, mw - mx0, H - 2 * my0, "none", INK2, 0.8, 6))
    s.append(linea(ax, ay, bx, by, INK, 2.4))
    for nombre, lat, lon in (ORIGEN, DESTINO):
        x, y = P(lat, lon)
        s.append(rect(x - 6, y - 6, 12, 12, INK, INK, 1, 2))
        s += th(x + 12, y + 4, nombre, 10, 700, INK)
    resultados = []
    for ident, rec, ret, ent, pasa in OFERTAS:
        x1, y1 = P(*ret)
        x2, y2 = P(*ent)
        col = INK if pasa else ROJO
        # Arco leve hacia un costado para que el recorrido no se confunda con el segmento del viaje
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        nx, ny = -(y2 - y1), (x2 - x1)
        kk = 0.18 * (1 if ident != "OFFER-104" else -1)
        s.append(camino(f"M{x1:.1f},{y1:.1f} Q{cx + kk * nx:.1f},{cy + kk * ny:.1f} {x2:.1f},{y2:.1f}", col, 1.4,
                        "" if pasa else "4 3", "fl" if pasa else "flr"))
        s.append(circulo(x1, y1, 4, BLANCO, col, 1.4))
        d1, d2 = _dist_segmento(ret, a, b), _dist_segmento(ent, a, b)
        resultados.append((ident, rec, d1, d2, pasa))
    # Etiquetas de cada oferta (posiciones a mano para que no se pisen)
    etiquetas = {
        "OFFER-101": P(-31.62, -63.84),
        "OFFER-102": P(-32.12, -63.30),
        "OFFER-103": P(-31.17, -64.42),
        "OFFER-104": P(-32.98, -64.30),
    }
    for ident, rec, d1, d2, pasa in resultados:
        x, y = etiquetas[ident]
        col = INK if pasa else ROJO
        s += th(x, y, ident, 8.6, 700, col, mono=True)
        s += th(x, y + 11, rec, 8.2, 400, col)
    # Escala gráfica de 50 km y atribución de OpenStreetMap
    sx, sy = mw - 50 * esc - 20, H - 44
    s.append(rect(sx - 34, sy - 22, 50 * esc + 46, 32, "#FFFFFF", INK2, 0.6, 4, 'fill-opacity="0.85"'))
    s.append(linea(sx, sy, sx + 50 * esc, sy, INK, 1.4))
    for xx in (sx, sx + 50 * esc):
        s.append(linea(xx, sy - 4, xx, sy + 4, INK, 1.4))
    s.append(t(sx + 25 * esc, sy - 7, "50 km", 8, color=INK6))
    s.append(t(sx - 18, sy + 3, "N ↑", 9, 700, INK6))
    s.append(rect(mx0 + 1, H - my0 - 15, 158, 14, "#FFFFFF", "none", 0, 0, 'fill-opacity="0.85"'))
    s.append(t(mx0 + 5, H - my0 - 4.5, "© colaboradores de OpenStreetMap", 6.4, 400, INK6, "start"))
    # Panel derecho: resultado del prefiltro
    px = mw + 20
    s.append(t(px, 34, "Prefiltro de corredor", 11, 700, anchor="start"))
    s.append(t(px, 50, f"Pasa si retiro y entrega quedan a ≤ {num(MAX_DESVIO_KM)} km", 8.6, color=INK6, anchor="start"))
    s.append(t(px, 62, "del segmento origen → destino del viaje", 8.6, color=INK6, anchor="start"))
    y = 90
    for ident, rec, d1, d2, pasa in resultados:
        s.append(rect(px, y, W - px - 14, 66, LIME_SUAVE if pasa else BLANCO, INK if pasa else INK2, 1, 5))
        s.append(t(px + 10, y + 17, ident, 9, 700, anchor="start", mono=True))
        s.append(t(W - 24, y + 17, "PASA" if pasa else "DESCARTADA", 8, 700, INK if pasa else ROJO, "end"))
        s.append(t(px + 10, y + 31, rec, 8.6, color=INK6, anchor="start"))
        s.append(t(px + 10, y + 47, f"retiro a {num(d1, 2)} km", 8.4, anchor="start", mono=True))
        s.append(t(px + 10, y + 59, f"entrega a {num(d2, 2)} km", 8.4, anchor="start", mono=True))
        y += 76
    s.append(t(px, y + 6, "Solo las que pasan se envían a OR-Tools.", 8.4, color=INK6, anchor="start"))
    s.append(t(px, y + 18, "Distancias en línea recta (Haversine).", 8.4, color=INK6, anchor="start"))
    guardar("ia-corredor", W, H, s, flecha_defs(INK) + flecha_defs(ROJO, "flr"))


# ───────────────────────── C · Rango de emisiones anuales ─────────────────────────


def rango() -> None:
    W, H = 680, 150
    x0, x1, vmax = 250, 650, 12

    def X(v):
        return x0 + v / vmax * (x1 - x0)

    filas = [
        ("Coeficientes fijados", "CCF commit e48c659 · FE 0,074", 2.7, 10.8, "36,5 a 145,9 kWh/año", LIME),
        ("Coeficientes del sitio actual", "CCF hoy · FE 0,064", 2.4, 9.4, "37,7 a 147,5 kWh/año", INK2),
    ]
    s = []
    top = 26
    for v in range(0, vmax + 1, 2):
        s.append(linea(X(v), top - 6, X(v), top + 2 * 46 - 6, INK2, 0.6))
        s.append(t(X(v), top + 2 * 46 + 6, num(v), 8, color=INK4, mono=True))
    s.append(t((x0 + x1) / 2, top + 2 * 46 + 22, "kgCO₂e por año (dev + prod)", 8.4, color=INK6))
    for i, (nom, sub, a, b, kwh, fill) in enumerate(filas):
        y = top + i * 46
        s.append(t(x0 - 14, y + 6, nom, 9.4, 600, anchor="end"))
        s.append(t(x0 - 14, y + 18, sub, 8, color=INK6, anchor="end"))
        s.append(t(x0 - 14, y + 29, kwh, 8, color=INK6, anchor="end", mono=True))
        s.append(rect(X(a), y + 2, X(b) - X(a), 16, fill, INK, 1, 8))
        s.append(t(X(a) - 6, y + 14, num(a, 1), 8.6, 600, anchor="end", mono=True))
        s.append(t(X(b) + 6, y + 14, num(b, 1), 8.6, 600, anchor="start", mono=True))
    s.append(t(X(2.7), top - 12, "CPU al 0 %", 8, color=INK6))
    s.append(t(X(10.8), top - 12, "CPU al 100 %", 8, color=INK6))
    guardar("ia-rango", W, H, s)


# ───────────────────────── D · Límites del análisis ─────────────────────────


def limites() -> None:
    W, H = 680, 330
    s = []
    # Límite del análisis
    bx, by, bw, bh = 200, 92, 280, 146
    s.append(rect(bx, by, bw, bh, INK05, INK, 1.6, 10))
    s.append(t(bx + bw / 2, by + 20, "LÍMITE DEL ANÁLISIS", 8.4, 700, INK6, extra='letter-spacing="1.4"'))
    s.append(rect(bx + 18, by + 34, bw - 36, 46, LIME, INK, 1, 6))
    s.append(t(bx + bw / 2, by + 53, "Instancias EC2 dev y prod", 10, 700))
    s.append(t(bx + bw / 2, by + 68, "cómputo, memoria y disco · cotas", 8.4, color=INK6))
    s.append(rect(bx + 18, by + 88, bw - 36, 46, BLANCO, INK, 1, 6))
    s.append(t(bx + bw / 2, by + 107, "Emisiones evitadas por envío", 10, 700))
    s.append(t(bx + bw / 2, by + 122, "condicionadas a reemplazar un viaje", 8.4, color=INK6))
    fuera = [
        (20, 30, "Transferencia de red", "sin datos de tráfico"),
        (500, 30, "Imágenes en S3", "sin datos de volumen"),
        (20, 140, "Desarrollo y CI", "sin horas ni potencia medidas"),
        (500, 140, "Dispositivos de usuarios", "tracking sin medición real"),
        (20, 250, "Fabricación de hardware", "sin dato del proveedor"),
        (500, 250, "SaaS de terceros e IA", "Vercel, Twilio, Didit, Maps…"),
    ]
    for x, y, nom, sub in fuera:
        s.append(rect(x, y, 160, 50, BLANCO, INK4, 1, 6, 'stroke-dasharray="4 3"'))
        s.append(t(x + 80, y + 21, nom, 9.4, 600, INK6))
        s.append(t(x + 80, y + 35, sub, 8, color=INK4))
        cx = x + 160 if x < bx else x
        s.append(linea(cx, y + 25, bx if x < bx else bx + bw, min(max(y + 25, by + 10), by + bh - 10), INK2, 0.8, "2 3"))
    # Leyenda
    ly = H - 14
    s.append(rect(150, ly - 9, 12, 10, LIME, INK, 0.8, 2))
    s.append(t(168, ly, "cuantificado", 8.4, color=INK6, anchor="start"))
    s.append(rect(270, ly - 9, 12, 10, BLANCO, INK, 0.8, 2))
    s.append(t(288, ly, "cuantificado, condicional", 8.4, color=INK6, anchor="start"))
    s.append(rect(470, ly - 9, 12, 10, BLANCO, INK4, 0.8, 2, 'stroke-dasharray="2 2"'))
    s.append(t(488, ly, "no cuantificado", 8.4, color=INK6, anchor="start"))
    guardar("ia-limites", W, H, s)


# ───────────────────────── E · Factores de emisión ─────────────────────────


def factores() -> None:
    W, H = 680, 128
    x0, x1, vmax = 250, 640, 0.30

    def X(v):
        return x0 + v / vmax * (x1 - x0)

    filas = [
        ("AWS sa-east-1 (São Paulo)", "CCF · fijado / sitio actual", 0.074, 0.064, LIME),
        ("Red eléctrica argentina, 2022", "SNIGEI-AR 2025, tabla 5", 0.283, None, NARANJA_SUAVE),
    ]
    s = []
    top = 18
    for v in (0, 0.1, 0.2, 0.3):
        s.append(linea(X(v), top - 4, X(v), top + 2 * 36 - 4, INK2, 0.6))
        s.append(t(X(v), top + 2 * 36 + 8, num(v, 1), 8, color=INK4, mono=True))
    s.append(t((x0 + x1) / 2, top + 2 * 36 + 24, "kgCO₂e por kWh", 8.4, color=INK6))
    for i, (nom, sub, v, v2, fill) in enumerate(filas):
        y = top + i * 36
        s.append(t(x0 - 14, y + 9, nom, 9.4, 600, anchor="end"))
        s.append(t(x0 - 14, y + 21, sub, 8, color=INK6, anchor="end"))
        s.append(rect(x0, y, X(v) - x0, 22, fill, INK, 1, 3))
        etiqueta = num(v, 3) if v2 is None else f"{num(v, 3)} / {num(v2, 3)}"
        s.append(t(X(v) + 6, y + 15, etiqueta, 9, 600, anchor="start", mono=True))
        if v2 is not None:
            s.append(linea(X(v2), y - 3, X(v2), y + 25, INK, 1.2, "2 2"))
    s.append(t(X(0.283) - 4, top + 36 + 15, "3,8 veces más", 8.4, 700, INK, "end"))
    guardar("ia-factores", W, H, s)


if __name__ == "__main__":
    escala()
    corredor()
    rango()
    limites()
    factores()
