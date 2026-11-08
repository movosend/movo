#!/usr/bin/env python3
"""Gráficos de gestión del Tomo I: Estudio Inicial, Plan de Proyecto, Plan de Testing y Resumen de sprints.

Cada gráfico toma sus cifras de la tabla del documento que acompaña (se cita en cada función); si la
tabla cambia, hay que cambiar acá también.
"""
from svg_comun import (AMBAR, AMBAR_SUAVE, NARANJA, NARANJA_SUAVE, ROJO, ROJO_SUAVE, VERDE, VERDE_SUAVE, BLANCO, INK, INK05, INK1, INK2, INK4, INK6, LIME, LIME_SUAVE, camino, circulo,
                       flecha_defs, guardar, linea, num, rayado_defs, rect, t)

# ───────────────────────── Plan de Proyecto · matriz de riesgos ─────────────────────────

# Registro inicial de riesgos (Plan de Proyecto, "Identificación y evaluación de riesgos").
RIESGOS = [
    ("R01", "Disponibilidad real del equipo", "Alta", "Alto"),
    ("R02", "Integración con Didit.me", "Media", "Alto"),
    ("R03", "Convergencia de OR-Tools", "Media", "Alto"),
    ("R04", "Subestimación de horas", "Media", "Alto"),
    ("R05", "Solapamiento con exámenes", "Alta", "Medio"),
    ("R06", "Conocimiento concentrado", "Media", "Alto"),
    ("R07", "Scope creep", "Media", "Alto"),
    ("R08", "Demo dependiente de servicios externos", "Media", "Alto"),
    ("R09", "Handshake con NFC entre dispositivos", "Media", "Medio"),
    ("R10", "Costo de APIs externas", "Media", "Medio"),
    ("R11", "Cambios en servicios de terceros", "Baja", "Alto"),
]
PRIORIDAD = {  # (probabilidad, impacto) -> prioridad, según la matriz del Plan de Proyecto
    ("Baja", "Bajo"): "Bajo", ("Baja", "Medio"): "Bajo", ("Baja", "Alto"): "Medio",
    ("Media", "Bajo"): "Bajo", ("Media", "Medio"): "Medio", ("Media", "Alto"): "Alto",
    ("Alta", "Bajo"): "Medio", ("Alta", "Medio"): "Alto", ("Alta", "Alto"): "Crítico",
}
COLOR_PRIORIDAD = {"Bajo": VERDE_SUAVE, "Medio": AMBAR_SUAVE, "Alto": NARANJA_SUAVE, "Crítico": ROJO_SUAVE}
TINTA_PRIORIDAD = {"Bajo": VERDE, "Medio": AMBAR, "Alto": NARANJA, "Crítico": ROJO}


def riesgos() -> None:
    W, H = 760, 380
    x0, y0, cw, ch = 96, 30, 124, 96
    probs, imps = ["Alta", "Media", "Baja"], ["Bajo", "Medio", "Alto"]
    s = []
    for r, p in enumerate(probs):
        s.append(t(x0 - 14, y0 + r * ch + ch / 2 + 4, p, 9.4, 600, anchor="end"))
        for c, i in enumerate(imps):
            pr = PRIORIDAD[(p, i)]
            x, y = x0 + c * cw, y0 + r * ch
            s.append(rect(x, y, cw, ch, COLOR_PRIORIDAD[pr], INK, 0.8, 0))
            s.append(t(x + cw - 8, y + 14, pr.upper(), 7.4, 700, TINTA_PRIORIDAD[pr], "end", extra='letter-spacing="0.8"'))
            ids = [rid for rid, _, rp, ri in RIESGOS if rp == p and ri == i]
            for k, rid in enumerate(ids):
                cx = x + 23 + (k % 3) * 39
                cy = y + 38 + (k // 3) * 28
                s.append(rect(cx - 17, cy - 11, 34, 20, BLANCO, INK, 1, 10))
                s.append(t(cx, cy + 3.5, rid, 8.6, 700, mono=True))
    for c, i in enumerate(imps):
        s.append(t(x0 + c * cw + cw / 2, y0 + 3 * ch + 18, i, 9.4, 600))
    s.append(t(x0 + 1.5 * cw, y0 + 3 * ch + 36, "IMPACTO →", 8.4, 700, INK6, extra='letter-spacing="1.2"'))
    s.append(t(22, y0 + 1.5 * ch, "PROBABILIDAD →", 8.4, 700, INK6,
               extra=f'letter-spacing="1.2" transform="rotate(-90 22 {y0 + 1.5 * ch})"'))
    # Referencias
    lx = x0 + 3 * cw + 30
    s.append(t(lx, y0 + 6, "Riesgos del registro inicial", 9.6, 700, anchor="start"))
    for k, (rid, nom, p, i) in enumerate(RIESGOS):
        y = y0 + 26 + k * 21
        s.append(rect(lx, y - 9, 10, 10, COLOR_PRIORIDAD[PRIORIDAD[(p, i)]], INK, 0.7, 2))
        s.append(t(lx + 16, y, rid, 8.4, 700, anchor="start", mono=True))
        s.append(t(lx + 46, y, nom, 8.4, color=INK6, anchor="start"))
    guardar("pp-riesgos", W, H, s)


# ───────────────────────── Plan de Proyecto · punto de equilibrio ─────────────────────────

COSTO_FIJO = 65.0  # USD por mes, escenario medio
COMISION = 0.15


def equilibrio() -> None:
    W, H = 680, 300
    x0, x1, y0, y1 = 70, 650, 24, 250  # área del gráfico
    tmin, tmax, nmax = 4, 16, 120

    def X(v):
        return x0 + (v - tmin) / (tmax - tmin) * (x1 - x0)

    def Y(v):
        return y1 - v / nmax * (y1 - y0)

    s = []
    for n in range(0, nmax + 1, 20):
        s.append(linea(x0, Y(n), x1, Y(n), INK2, 0.6))
        s.append(t(x0 - 8, Y(n) + 3, str(n), 8, color=INK4, anchor="end", mono=True))
    for v in range(tmin, tmax + 1, 2):
        s.append(t(X(v), y1 + 14, f"USD {v}", 8, color=INK4, mono=True))
    s.append(t((x0 + x1) / 2, y1 + 32, "Ticket promedio por envío", 8.6, color=INK6))
    s.append(t(18, (y0 + y1) / 2, "Envíos por mes para cubrir USD 65", 8.6, color=INK6,
               extra=f'transform="rotate(-90 18 {(y0 + y1) / 2})"'))
    pts = []
    v = tmin
    while v <= tmax + 1e-9:
        pts.append((X(v), Y(min(COSTO_FIJO / (COMISION * v), nmax))))
        v += 0.1
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in pts)
    s.append(f'<path d="{d} L{x1},{y1} L{x0},{y1} Z" fill="{ROJO_SUAVE}" fill-opacity="0.55" stroke="none"/>')
    s.append(f'<path d="{d} L{x1},{y0} L{x0},{y0} Z" fill="{LIME_SUAVE}" stroke="none"/>')
    s.append(f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="2"/>')
    s.append(t(X(11.2), Y(98), "Zona con margen positivo", 9.4, 700, anchor="start"))
    s.append(t(X(11.2), Y(98) + 13, "cada envío extra suma USD 0,15 × ticket", 8.2, color=INK6, anchor="start"))
    s.append(t(X(5.2), Y(16), "Por debajo de la curva, la comisión", 8.2, color=INK6, anchor="start"))
    s.append(t(X(5.2), Y(16) + 11, "no cubre el costo fijo", 8.2, color=INK6, anchor="start"))
    for tk, dest in ((5, False), (8, True), (12, False)):
        n = COSTO_FIJO / (COMISION * tk)
        s.append(linea(X(tk), Y(n), X(tk), y1, INK4, 0.8, "2 2"))
        s.append(circulo(X(tk), Y(n), 5.5 if dest else 4.5, LIME if dest else BLANCO, INK, 1.4))
        s.append(t(X(tk) + 8, Y(n) - 22, f"~{round(n)} envíos/mes", 8.8, 700, anchor="start", mono=True))
        s.append(t(X(tk) + 8, Y(n) - 10, f"≈ {num(n / 30, 1)} por día", 8, color=INK6, anchor="start"))
    guardar("pp-equilibrio", W, H, s)


# ───────────────────────── Plan de Proyecto · flujo de fondos por transacción ─────────────────────────


def flujo_fondos() -> None:
    W, H = 770, 260
    s = []
    esc = 15  # px por USD
    yc = 112
    # Etapas
    etapas = [(20, "Emisor", "confirma la oferta"), (190, "Hold", "fondos reservados,\nno debitados"),
              (360, "Entrega", "handshake: captura\ny split en un evento")]
    for x, nom, sub in etapas:
        s.append(rect(x, yc - 10 * esc / 2, 130, 10 * esc, INK1 if x else BLANCO, INK, 1.2, 6))
        s.append(t(x + 65, yc - 6, nom, 10.4, 700))
        s.append(t(x + 65, yc + 10, sub, 8.4, color=INK6))
    s.append(t(85, yc + 10 * esc / 2 + 16, "USD 10,00", 10, 700, mono=True))
    for xa, xb in ((150, 190), (320, 360)):
        s.append(f'<rect x="{xa}" y="{yc - 10 * esc / 2 + 6}" width="{xb - xa}" height="{10 * esc - 12}" fill="{INK1}"/>')
        s.append(linea(xa, yc - 10 * esc / 2 + 6, xb, yc - 10 * esc / 2 + 6, INK2, 0.8))
        s.append(linea(xa, yc + 10 * esc / 2 - 6, xb, yc + 10 * esc / 2 - 6, INK2, 0.8))
    # Split: bandas proporcionales al monto
    xs, xd = 490, 590
    top = yc - 10 * esc / 2
    h_t, h_m = 8.5 * esc, 1.5 * esc
    yt, ym = 26, 26 + h_t + 26
    s.append(f'<path d="M{xs},{top} C{xs + 50},{top} {xd - 50},{yt} {xd},{yt} L{xd},{yt + h_t} '
             f'C{xd - 50},{yt + h_t} {xs + 50},{top + h_t} {xs},{top + h_t} Z" fill="{INK1}" stroke="{INK2}" stroke-width="0.8"/>')
    s.append(f'<path d="M{xs},{top + h_t} C{xs + 50},{top + h_t} {xd - 50},{ym} {xd},{ym} L{xd},{ym + h_m} '
             f'C{xd - 50},{ym + h_m} {xs + 50},{top + h_t + h_m} {xs},{top + h_t + h_m} Z" fill="{LIME}" stroke="{INK}" stroke-width="0.8"/>')
    s.append(rect(xd, yt, 10, h_t, INK, INK, 1, 0))
    s.append(rect(xd, ym, 10, h_m, INK, INK, 1, 0))
    s.append(t(xd + 18, yt + h_t / 2 - 4, "Transportista · 85 %", 10, 700, anchor="start"))
    s.append(t(xd + 18, yt + h_t / 2 + 11, "USD 8,50 · pago neto", 9, anchor="start", mono=True))
    s.append(t(xd + 18, ym + h_m / 2 - 2, "Movo · 15 %", 10, 700, anchor="start"))
    s.append(t(xd + 18, ym + h_m / 2 + 12, "USD 1,50 · comisión", 9, anchor="start", mono=True))
    # Cancelación antes del retiro
    yb = H - 20
    s.append(camino(f"M255,{yc + 10 * esc / 2} L255,{yb - 14}", INK4, 1.1, "4 3", "flg"))
    s.append(t(255, yb, "Cancelación antes del retiro: se libera el hold, sin cargo para el emisor", 8.6, color=INK6))
    guardar("pp-flujo-fondos", W, H, s, flecha_defs(INK4, "flg"))


# ───────────────────────── Plan de Proyecto · presupuesto y costo operativo ─────────────────────────

# Costo operativo mensual estimado (USD/mes): servicio, mínimo, máximo.
COSTO_OPERATIVO = [
    ("AWS EC2 (prod)", 30, 50),
    ("Vercel", 0, 20),
    ("Transferencia de datos AWS", 3, 8),
    ("AWS S3", 2, 5),
    ("AWS Secrets Manager", 2, 2),
    ("Dominio + TLS", 1.5, 1.5),
]


def presupuesto() -> None:
    W, H = 720, 400
    s = []
    # Panel 1: presupuesto total de desarrollo
    s.append(t(20, 22, "Presupuesto total de desarrollo · ~USD 9.526", 10.4, 700, anchor="start"))
    x0, x1, y = 20, 700, 40
    total = 9284 + 242
    xm = x0 + 9284 / total * (x1 - x0)
    s.append(rect(x0, y, xm - x0, 34, "url(#ray)", INK, 1, 0))
    s.append(rect(xm, y, x1 - xm, 34, LIME, INK, 1, 0))
    s.append(t(x0, y + 52, "Mano de obra valorizada (nocional) · USD 9.284 · 97,5 %", 9, 600, anchor="start"))
    s.append(t(x0, y + 65, "422 h × USD 22/h · no es una erogación real", 8.2, color=INK6, anchor="start"))
    s.append(t(x1, y + 52, "Gastos directos · ~USD 242 · 2,5 %", 9, 600, anchor="end"))
    s.append(t(x1, y + 65, "única salida real de caja", 8.2, color=INK6, anchor="end"))
    s.append(linea(xm + (x1 - xm) / 2, y + 34, x1 - 40, y + 42, INK, 0.8))
    # Panel 2: costo operativo mensual (rangos)
    yb = 150
    s.append(t(20, yb, "Costo operativo fijo mensual en producción · ~USD 40 a 90", 10.4, 700, anchor="start"))
    gx0, gx1, vmax = 210, 680, 60

    def X(v):
        return gx0 + v / vmax * (gx1 - gx0)

    filas_y0 = yb + 22
    paso = 30
    for v in range(0, vmax + 1, 10):
        s.append(linea(X(v), filas_y0 - 6, X(v), filas_y0 + paso * len(COSTO_OPERATIVO) - 6, INK2, 0.6))
        s.append(t(X(v), filas_y0 + paso * len(COSTO_OPERATIVO) + 6, str(v), 8, color=INK4, mono=True))
    s.append(t((gx0 + gx1) / 2, filas_y0 + paso * len(COSTO_OPERATIVO) + 22, "USD por mes", 8.4, color=INK6))
    for i, (nom, a, b) in enumerate(COSTO_OPERATIVO):
        yy = filas_y0 + i * paso
        s.append(t(gx0 - 12, yy + 9, nom, 9, 600, anchor="end"))
        if a == b:
            s.append(circulo(X(a), yy + 6, 5, INK, INK))
            s.append(t(X(a) + 10, yy + 9.5, num(a, 1 if a % 1 else 0), 8.4, 600, anchor="start", mono=True))
        else:
            s.append(rect(X(a), yy, max(X(b) - X(a), 4), 12, LIME if i == 0 else INK2, INK, 1, 6))
            s.append(t(X(b) + 8, yy + 9.5, f"{num(a)} a {num(b)}", 8.4, 600, anchor="start", mono=True))
    yv = filas_y0 + paso * len(COSTO_OPERATIVO) + 40
    s.append(t(gx0 - 12, yv, "Variables: Didit.me (por usuario nuevo) y Google Maps (cubierto por el crédito de USD 200/mes).",
               8.2, color=INK6, anchor="start"))
    guardar("pp-presupuesto", W, H, s, rayado_defs("ray", INK2))


# ───────────────────────── Plan de Testing · casos y cobertura ─────────────────────────

# "Resultado de la ejecución de las pruebas automatizadas por paquete" (04/11/2026) y
# "Umbrales de cobertura vigentes" (umbral de líneas, None si no tiene).
PRUEBAS = [
    ("movo-mobile", 3079, None, None),
    ("movo-svc-shipments", 2342, 91.3, None),
    ("movo-svc-users", 901, 89.4, 55),
    ("movo-svc-payments", 783, 95.5, None),
    ("movo-admin", 590, 59.5, None),
    ("movo-svc-admin", 362, 84.4, 70),
    ("movo-svc-pricing-logistics", 175, 94.5, 55),
    ("shared/movo-shared", 162, 59.9, 95),
    ("gateway", 124, 98.9, None),
]


def cobertura() -> None:
    W, H = 720, 352
    s = []
    top, paso = 58, 28
    # Columna izquierda: casos aprobados
    ax0, ax1, cmax = 214, 400, 3200
    s.append(t(20, 20, "Casos aprobados · 8.518 en total", 10.2, 700, anchor="start"))
    # Columna derecha: cobertura de líneas
    bx0, bx1 = 450, 690
    s.append(t(bx0, 20, "Cobertura de líneas", 10.2, 700, anchor="start"))

    def B(v):
        return bx0 + v / 100 * (bx1 - bx0)

    for v in range(0, 101, 25):
        s.append(linea(B(v), top - 10, B(v), top + paso * len(PRUEBAS) - 8, INK2, 0.6))
        s.append(t(B(v), top + paso * len(PRUEBAS) + 4, f"{v} %", 8, color=INK4, mono=True))
    for i, (pkg, casos, cob, umbral) in enumerate(PRUEBAS):
        y = top + i * paso
        s.append(t(ax0 - 10, y + 8, pkg, 8.8, 600, anchor="end", mono=True))
        w = casos / cmax * (ax1 - ax0)
        s.append(rect(ax0, y - 2, w, 14, INK1, INK, 0.9, 2))
        s.append(t(ax0 + w + 6, y + 9, num(casos), 8.4, 600, anchor="start", mono=True))
        s.append(linea(bx0, y + 5, bx1, y + 5, INK05, 6))
        if cob is None:
            s.append(t(bx0 + 4, y + 9, "no medida", 8.2, color=INK4, anchor="start"))
            continue
        if umbral is not None:
            s.append(linea(B(umbral), y - 3, B(umbral), y + 13, INK6, 1.6))
        bajo = umbral is not None and cob < umbral
        s.append(circulo(B(cob), y + 5, 5.5, ROJO_SUAVE if bajo or cob < 70 else LIME, ROJO if bajo or cob < 70 else INK, 1.3))
        s.append(t(B(cob) + (-9 if cob > 90 else 9), y + 9, f"{num(cob, 1)}", 8.2, 600, anchor="end" if cob > 90 else "start", mono=True))
    s.insert(0, "")  # la línea del 70 % va encima de las pistas, debajo de los puntos
    lineas_70 = [rect(B(70) - 0.8, top - 14, 1.6, paso * len(PRUEBAS) + 8, INK, INK, 0, 0),
                 t(B(70), top - 18, "70 % acordado", 8, 700, INK, "middle")]
    idx = next(i for i, e in enumerate(s) if "<circle" in e)
    s[idx:idx] = lineas_70
    ly = H - 16
    s.append(circulo(bx0 - 230, ly - 3, 4.5, LIME, INK, 1.2))
    s.append(t(bx0 - 222, ly, "sobre el 70 %", 8.2, color=INK6, anchor="start"))
    s.append(circulo(bx0 - 130, ly - 3, 4.5, ROJO_SUAVE, ROJO, 1.2))
    s.append(t(bx0 - 122, ly, "bajo el 70 % o bajo su umbral", 8.2, color=INK6, anchor="start"))
    s.append(linea(bx0 + 30, ly - 9, bx0 + 30, ly + 3, INK6, 1.6))
    s.append(t(bx0 + 38, ly, "umbral configurado del paquete", 8.2, color=INK6, anchor="start"))
    guardar("pt-cobertura", W, H, s)


# ───────────────────────── Estudio Inicial · posicionamiento competitivo ─────────────────────────


def posicionamiento() -> None:
    W, H = 680, 420
    x0, x1, y0, y1 = 70, 610, 30, 360
    s = []
    s.append(rect(x0, y0, x1 - x0, y1 - y0, INK05, INK2, 1, 6))
    xm, ym = (x0 + x1) / 2, (y0 + y1) / 2
    s.append(linea(xm, y0, xm, y1, INK2, 1, "4 3"))
    s.append(linea(x0, ym, x1, ym, INK2, 1, "4 3"))
    s.append(t(x0 + 10, y1 + 18, "← Flota o red logística propia", 8.8, 600, INK6, "start"))
    s.append(t(x1 - 10, y1 + 18, "Viajes de particulares que ya ocurren →", 8.8, 600, INK6, "end"))
    s.append(t(x0 - 14, y0 + 50, "Interurbano", 8.8, 600, INK6, "middle", extra=f'transform="rotate(-90 {x0 - 14} {y0 + 50})"'))
    s.append(t(x0 - 14, y1 - 50, "Urbano / última milla", 8.8, 600, INK6, "middle", extra=f'transform="rotate(-90 {x0 - 14} {y1 - 50})"'))
    actores = [  # (nombre, x 0..1, y 0..1 (1 = interurbano), relleno, nota)
        ("Correo Argentino · Andreani · OCA", 0.14, 0.86, INK2, "centralizada, costosa"),
        ("Mercado Envíos", 0.24, 0.66, INK2, "atado a Mercado Libre"),
        ("Treggo · Rapiboy", 0.20, 0.20, INK2, "última milla B2B/B2C"),
        ("Rappi · PedidosYa", 0.40, 0.12, INK2, "couriers dependientes"),
        ("Grupos de WhatsApp o Facebook", 0.86, 0.52, BLANCO, "sin garantías ni pagos"),
        ("Movo", 0.86, 0.84, LIME, "P2P con KYC, handshake y pago"),
    ]
    for nom, fx, fy, fill, nota in actores:
        cx, cy = x0 + fx * (x1 - x0), y1 - fy * (y1 - y0)
        r = 10 if nom == "Movo" else 7
        dash = 'stroke-dasharray="3 2"' if fill == BLANCO else ""
        s.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r}" fill="{fill}" stroke="{INK}" stroke-width="1.3" {dash}/>')
        anc = "end" if fx > 0.7 else "start"
        dx = -(r + 6) if anc == "end" else r + 6
        s.append(t(cx + dx, cy - 1, nom, 10 if nom == "Movo" else 9.2, 700, anchor=anc))
        s.append(t(cx + dx, cy + 11, nota, 8.2, color=INK6, anchor=anc))
    ly = H - 18
    for i, (fill, lab) in enumerate(((INK2, "con garantías y trazabilidad"), (BLANCO, "sin garantías"),
                                     (LIME, "Movo"))):
        lx = x0 + i * 200
        dash = 'stroke-dasharray="3 2"' if fill == BLANCO else ""
        s.append(f'<circle cx="{lx + 5}" cy="{ly - 3}" r="5" fill="{fill}" stroke="{INK}" stroke-width="1.1" {dash}/>')
        s.append(t(lx + 16, ly, lab, 8.4, color=INK6, anchor="start"))
    guardar("ei-posicionamiento", W, H, s)


# ───────────────────────── Resumen de sprints · burn-up ─────────────────────────

# Velocity por sprint (Resumen del Proceso): sprint, SP completados, issues.
SPRINTS = [("S1", 22, 7), ("S2", 95, 32), ("S3", 121, 41), ("S4", 106, 42), ("S5", 80, 32),
           ("S6", 135, 48), ("S7", 150, 59), ("S8", 160, 48)]


def burnup() -> None:
    W, H = 680, 280
    x0, x1, y0, y1 = 60, 600, 26, 230
    total = sum(v for _, v, _ in SPRINTS)
    ymax = 900

    def X(i):
        return x0 + i / len(SPRINTS) * (x1 - x0)

    def Y(v):
        return y1 - v / ymax * (y1 - y0)

    s = []
    for v in range(0, ymax + 1, 150):
        s.append(linea(x0, Y(v), x1, Y(v), INK2, 0.6))
        s.append(t(x0 - 8, Y(v) + 3, num(v), 8, color=INK4, anchor="end", mono=True))
    s.append(t(16, (y0 + y1) / 2, "Story Points acumulados", 8.6, color=INK6,
               extra=f'transform="rotate(-90 16 {(y0 + y1) / 2})"'))
    acum, pts = 0, [(X(0), Y(0))]
    for i, (nom, v, _) in enumerate(SPRINTS, 1):
        prev = acum
        acum += v
        s.append(rect(X(i) - 14, Y(acum), 28, Y(prev) - Y(acum), LIME_SUAVE if i < len(SPRINTS) else LIME, INK, 0.8, 2))
        pts.append((X(i), Y(acum)))
        s.append(t(X(i) + 18, (Y(prev) + Y(acum)) / 2 + 3, f"+{v}", 7.8, 600, INK6, "start", True))
        s.append(t(X(i), y1 + 14, nom, 8.6, color=INK6))
    s.append(f'<polyline points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in pts)}" fill="none" stroke="{INK}" stroke-width="2"/>')
    for x, y in pts[1:]:
        s.append(circulo(x, y, 3.2, INK, INK))
    s.append(t(X(len(SPRINTS)) - 8, Y(total) - 10, f"{num(total)} SP en 8 sprints", 10, 700, anchor="end", mono=True))
    # Promedio lineal de referencia
    s.append(linea(X(0), Y(0), X(len(SPRINTS)), Y(total), INK4, 1, "4 3"))
    s.append(t(X(3.0), Y(total * 3 / 8) - 30, "ritmo promedio", 8.2, color=INK4))
    s.append(t(X(3.0), Y(total * 3 / 8) - 19, f"{num(total / len(SPRINTS), 1)} SP por sprint", 8.2, color=INK4))
    s.append(t((x0 + x1) / 2, y1 + 32, "Sprint (el Sprint 0 fue previo a Linear)", 8.6, color=INK6))
    guardar("rs-burnup", W, H, s)


if __name__ == "__main__":
    riesgos()
    equilibrio()
    flujo_fondos()
    presupuesto()
    cobertura()
    posicionamiento()
    burnup()
