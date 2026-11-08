#!/usr/bin/env python3
"""Gráficos del Tomo III: plazos del proceso (Manual de Procedimientos), estados y costo de cancelar
(Manual de Usuario) y puertos del entorno local (Manual de Instalación).

Los estados siguen las transiciones de `shipment-state-machine.ts` y `offer-state-machine.ts` con los
nombres que ve el usuario en la app; los plazos, la tabla "Plazos, umbrales y reglas vigentes".
"""
from svg_comun import (AMBAR_SUAVE, ROJO, ROJO_SUAVE, BLANCO, INK, INK05, INK1, INK2, INK4, INK6, LIME, LIME_SUAVE, camino, flecha_defs,
                       guardar, linea, rayado_defs, rect, t)

# ───────────────────────── Manual de Procedimientos · plazos del proceso ─────────────────────────


def plazos() -> None:
    W, H = 760, 516
    s = []
    hitos = [(70, "Cotización"), (190, "Publicación"), (330, "Aceptar oferta"), (480, "Retiro"),
             (600, "Entrega"), (712, "Cierre")]
    yl = 70
    s.append(linea(30, yl, 740, yl, INK, 2.4))
    for x, nom in hitos:
        s.append(f'<circle cx="{x}" cy="{yl}" r="7" fill="{LIME}" stroke="{INK}" stroke-width="1.6"/>')
        s.append(t(x, yl - 16, nom, 9.6, 700))
    s.append(t(735, yl + 24, "esquema, no a escala", 7.6, 400, INK4, "end"))

    def tramo(xa, xb, y, titulo, detalle, fill=INK1, borde=INK, dash=""):
        d = f'stroke-dasharray="{dash}"' if dash else ""
        s.append(rect(xa, y, xb - xa, 34, fill, borde, 1, 4, d))
        s.append(t(xa + 7, y + 14, titulo, 8.6, 700, anchor="start"))
        s.append(t(xa + 7, y + 27, detalle, 7.8, color=INK6, anchor="start"))

    def grupo(y, etiqueta):
        s.append(t(30, y, etiqueta.upper(), 7.6, 700, INK4, "start", extra='letter-spacing="1.2"'))

    grupo(112, "Emisor y receptor")
    tramo(70, 186, 120, "Precio congelado", "15 minutos (quoteId)")
    tramo(190, 326, 120, "Receptor acepta", "48 h; si rechaza, 48 h más")
    tramo(330, 476, 120, "Retiro a ≤ 3 días", "pagar en 30 min (+15 ×2)")
    tramo(330, 476, 160, "Retiro a más de 3 días", "pagar hasta 24 h antes", BLANCO)
    tramo(600, 740, 120, "Calificar", "72 h desde la entrega")
    tramo(600, 740, 160, "Abrir una disputa", "7 días desde la entrega", BLANCO)

    grupo(220, "Cancelación del emisor")
    tramo(190, 400, 228, "Sin cargo", "hasta 12 h antes del retiro", LIME_SUAVE)
    tramo(400, 476, 228, "25 %", "menos de 12 h", ROJO_SUAVE, ROJO)
    s.append(rect(480, 228, 120, 34, "url(#ray)", INK2, 1, 4))
    s.append(t(540, 249, "ya no se puede", 8, 700, INK6))

    grupo(290, "Mercado Pago y cobro")
    s.append(rect(330, 298, 330, 26, LIME_SUAVE, INK, 1, 4))
    s.append(t(338, 315, "Hold vigente 5 días (MP_HOLD_VALIDITY_DAYS)", 8.6, 700, anchor="start"))
    tramo(600, 740, 330, "Captura y split", "reintentos a 5, 30 y 120 min")

    grupo(384, "Transportista y sistema")
    tramo(420, 540, 392, "Handshake", "QR de 15 s, ≤ 100 m")
    tramo(600, 740, 392, "Traza GPS", "se borra a los 30 días")
    tramo(480, 596, 432, "Sin retiro", "gracia de 24 h", BLANCO)
    tramo(600, 740, 432, "Historial del envío", "se conserva 5 años", BLANCO)
    tramo(480, 640, 472, "Demora en tránsito", "aviso 12 h · disputa 24 h", BLANCO)
    for x, _ in hitos:
        s.append(linea(x, yl + 8, x, H - 10, INK2, 0.6, "2 3"))
    # Las líneas guía van debajo de todo
    guias = [e for e in s if 'stroke-dasharray="2 3"' in e]
    s = guias + [e for e in s if e not in guias]
    guardar("proc-plazos", W, H, s, rayado_defs("ray", INK2))


# ───────────────────────── Manual de Usuario · estados de un envío ─────────────────────────


def estados_envio() -> None:
    W, H = 776, 360
    s = []
    bw, bh, gap, x0, ym = 108, 40, 20, 14, 140
    principales = ["Esperando\nreceptor", "Publicado", "Asignado", "En camino", "Entregado", "Completado"]
    X = {n: x0 + i * (bw + gap) for i, n in enumerate(principales)}

    def caja(x, y, nom, fill=BLANCO, borde=INK, dash="", w=bw):
        d = f'stroke-dasharray="{dash}"' if dash else ""
        s.append(rect(x, y, w, bh, fill, borde, 1.3, 8, d))
        dy = 3.5 - 6.5 * nom.count("\n")
        s.append(t(x + w / 2, y + bh / 2 + dy, nom, 9, 700, INK if borde == INK else (ROJO if borde == ROJO else INK6)))

    for i, n in enumerate(principales):
        caja(X[n], ym, n, LIME if n == "Completado" else (LIME_SUAVE if i else BLANCO))
        if i:
            prev = principales[i - 1]
            s.append(camino(f"M{X[prev] + bw},{ym + bh / 2} L{X[n] - 2},{ym + bh / 2}", INK, 1.2))
    etiquetas = [("el receptor\nacepta", 0), ("elegís una\noferta", 1), ("retiro con\nQR", 2),
                 ("entrega con\nQR", 3), ("se acredita\nel cobro", 4)]
    for lab, i in etiquetas:
        s.append(t(X[principales[i]] + bw + gap / 2, ym - 18, lab, 7.4, 400, INK6))
    # Fondos pendientes (retiro lejano)
    xf, yf = X["Publicado"] + 50, 30
    caja(xf, yf, "Fondos pendientes", w=136)
    s.append(camino(f"M{X['Publicado'] + 30},{ym} C{X['Publicado'] + 30},{yf + 20} {xf - 20},{yf + 20} {xf - 2},{yf + 20}", INK, 1.1))
    s.append(camino(f"M{xf + 136},{yf + 20} C{X['Asignado'] + 60},{yf + 20} {X['Asignado'] + 74},{yf + 40} {X['Asignado'] + 74},{ym - 2}", INK, 1.1))
    s.append(t(xf + 68, yf - 8, "retiro lejano: pagás más cerca de la fecha", 7.6, 400, INK6))
    # Vuelta a Publicado si la asignación no prospera
    xa, xp = X["Asignado"], X["Publicado"]
    s.append(camino(f"M{xa + 20},{ym + bh} C{xa + 10},{ym + bh + 34} {xp + bw - 10},{ym + bh + 34} {xp + bw - 20},{ym + bh + 2}", INK4, 1.1, "4 3", "flg"))
    s.append(t((xa + xp + bw) / 2, ym + bh + 40, "no se completa el pago o", 7.4, 400, INK6))
    s.append(t((xa + xp + bw) / 2, ym + bh + 50, "el transportista se baja", 7.4, 400, INK6))
    # Rechazado
    xr, yr = X["Esperando\nreceptor"], 262
    caja(xr, yr, "Rechazado", INK1)
    s.append(camino(f"M{xr + 30},{ym + bh} L{xr + 30},{yr - 2}", INK, 1.1))
    s.append(camino(f"M{xr + 74},{yr} L{xr + 74},{ym + bh + 2}", INK, 1.1))
    s.append(t(xr + 26, (ym + bh + yr) / 2 + 3, "rechaza", 7.4, 400, INK6, "end"))
    s.append(t(xr + 78, (ym + bh + yr) / 2 - 2, "elegís otro", 7.4, 400, INK6, "start"))
    s.append(t(xr + 78, (ym + bh + yr) / 2 + 8, "receptor", 7.4, 400, INK6, "start"))
    # Cancelado
    xc, yc, wc = X["Publicado"] + 10, 300, 210
    caja(xc, yc, "Cancelado", ROJO_SUAVE, ROJO, "4 3", wc)
    s.append(t(xc + wc / 2, yc + bh + 13, "hasta el retiro; con penalidad si falta poco", 7.4, 400, INK6))
    s.append(camino(f"M{xr + bw},{yr + 20} C{xr + bw + 20},{yr + 20} {xc - 20},{yc + 20} {xc - 2},{yc + 20}", INK4, 1, "", "flg"))
    for n, dx in (("Publicado", 60), ("Asignado", 60)):
        s.append(camino(f"M{X[n] + dx},{ym + bh} L{X[n] + dx},{yc - 2}" if n == "Publicado" else
                        f"M{X[n] + dx},{ym + bh} C{X[n] + dx},{yc - 20} {xc + wc - 30},{yc - 20} {xc + wc - 30},{yc - 2}",
                        INK4, 1, "", "flg"))
    # En disputa
    xd, yd = X["En camino"] + 30, 280
    wd = X["Completado"] + bw / 2 + 30 - xd
    caja(xd, yd, "En disputa", AMBAR_SUAVE, INK, "", wd)
    for n in ("En camino", "Entregado", "Completado"):
        cx = X[n] + bw / 2
        s.append(camino(f"M{cx},{ym + bh} L{cx},{yd - 2}", INK, 1.1))
    s.append(t(xd + wd / 2, yd + bh + 13, "un administrador la resuelve: termina", 7.4, 400, INK6))
    s.append(t(xd + wd / 2, yd + bh + 23, "en Completado o en Cancelado", 7.4, 400, INK6))
    guardar("mu-estados-envio", W, H, s, flecha_defs(INK) + flecha_defs(INK4, "flg"))


# ───────────────────────── Manual de Usuario · estados de una oferta ─────────────────────────


def estados_oferta() -> None:
    W, H = 720, 290
    s = []

    def caja(x, y, w, nom, sub, fill=BLANCO, borde=INK):
        s.append(rect(x, y, w, 38, fill, borde, 1.2, 8))
        s.append(t(x + 10, y + 16, nom, 9, 700, anchor="start"))
        s.append(t(x + 10, y + 29, sub, 7.6, color=INK6, anchor="start"))

    caja(20, 126, 130, "En juego", "esperando al emisor", LIME_SUAVE)
    finales = [("Te la aceptaron", "te eligieron", LIME), ("No la tomó", "eligió a otro transportista", INK1),
               ("Venció sin respuesta", "pasó la fecha de retiro", INK1),
               ("La retiraste vos", "la sacaste antes de la respuesta", INK1),
               ("El envío se canceló", "el emisor canceló el envío", INK1)]
    ys = [20 + i * 54 for i in range(len(finales))]
    for (nom, sub, fill), y in zip(finales, ys):
        caja(250, y, 200, nom, sub, fill)
        s.append(camino(f"M150,145 C200,145 200,{y + 19} 248,{y + 19}", INK, 1.1))
    # Desde "Te la aceptaron"
    y0 = ys[0]
    for i, (nom, sub) in enumerate((("No se concretó", "el emisor no pagó a tiempo"),
                                     ("Te bajaste del envío", "después de que te eligieran"),
                                     ("El envío se canceló", "después de aceptarla"))):
        y = 6 + i * 46
        caja(520, y, 180, nom, sub, BLANCO, INK4)
        s.append(camino(f"M450,{y0 + 19} C485,{y0 + 19} 485,{y + 19} 518,{y + 19}", INK4, 1.1, "", "flg"))
    s.append(t(610, 162, "Si todo sale bien, la oferta queda", 7.8, 400, INK6))
    s.append(t(610, 173, "aceptada y seguís el envío desde", 7.8, 400, INK6))
    s.append(t(610, 184, "su detalle hasta la entrega.", 7.8, 400, INK6))
    s.append(t(85, 186, "podés cambiar precio y", 7.6, 400, INK6))
    s.append(t(85, 196, "fecha mientras siga así", 7.6, 400, INK6))
    guardar("mu-estados-oferta", W, H, s, flecha_defs(INK) + flecha_defs(INK4, "flg"))


# ───────────────────────── Manual de Usuario · costo de cancelar ─────────────────────────


def cancelacion() -> None:
    W, H = 720, 220
    x0, x1, y0, y1 = 80, 700, 30, 160
    s = []
    xa, x12, xr = 250, 520, 600  # elección del transportista, 12 h antes del retiro, retiro

    def Y(p):
        return y1 - p / 30 * (y1 - y0)

    for p in (0, 25):
        s.append(linea(x0, Y(p), x1, Y(p), INK2, 0.6))
        s.append(t(x0 - 8, Y(p) + 3, f"{p} %", 8, color=INK4, anchor="end", mono=True))
    s.append(t(20, (y0 + y1) / 2, "Costo", 8.4, color=INK6, extra=f'transform="rotate(-90 20 {(y0 + y1) / 2})"'))
    s.append(rect(x0, Y(0) - 3, x12 - x0, 6, LIME, INK, 1, 3))
    s.append(rect(x12, Y(25), xr - x12, Y(0) - Y(25), ROJO_SUAVE, ROJO, 1, 0))
    s.append(rect(xr, y0, x1 - xr, y1 - y0, "url(#ray)", INK2, 1, 0))
    s.append(t((xr + x1) / 2, (y0 + y1) / 2 - 2, "No se puede", 9, 700, INK6))
    s.append(t((xr + x1) / 2, (y0 + y1) / 2 + 11, "cancelar", 9, 700, INK6))
    s.append(t((x0 + xa) / 2, Y(0) - 14, "Sin costo", 9.4, 700))
    s.append(t((x0 + xa) / 2, Y(0) - 26, "sin transportista elegido", 7.8, 400, INK6))
    s.append(t((xa + x12) / 2, Y(0) - 14, "Sin costo: se libera la reserva", 9.4, 700))
    s.append(t((xa + x12) / 2, Y(0) - 26, "12 h o más antes del retiro", 7.8, 400, INK6))
    s.append(t((x12 + xr) / 2, Y(25) - 8, "25 % del precio", 9.4, 700))
    s.append(t((x12 + xr) / 2, Y(25) + 18, "se compensa", 7.6, 400, INK6))
    s.append(t((x12 + xr) / 2, Y(25) + 28, "al transportista", 7.6, 400, INK6))
    for x, lab in ((x0, "Publicás"), (xa, "Elegís transportista"), (x12, "12 h antes"), (xr, "Retiro")):
        s.append(linea(x, y1, x, y1 + 6, INK, 1.2))
        s.append(t(x, y1 + 20, lab, 8.6, 700))
    s.append(linea(x0, y1, x1, y1, INK, 1.2))
    s.append(t((x0 + x1) / 2, y1 + 44, "Tiempo →", 8.4, color=INK6))
    guardar("mu-cancelacion", W, H, s, rayado_defs("ray", INK2))


# ───────────────────────── Manual de Instalación · puertos del entorno local ─────────────────────────


def puertos() -> None:
    W, H = 720, 300
    s = []

    def caja(x, y, w, h, nom, puerto, fill=BLANCO):
        s.append(rect(x, y, w, h, fill, INK, 1.2, 6))
        s.append(t(x + w / 2, y + h / 2 - 2, nom, 8.6, 700, mono=True))
        s.append(t(x + w / 2, y + h / 2 + 11, puerto, 8, 400, INK6, mono=True))

    s.append(rect(142, 14, 564, 270, INK05, INK2, 0.8, 10))
    s.append(t(154, 30, "DOCKER COMPOSE · RED INTERNA", 7.6, 700, INK4, "start", extra='letter-spacing="1.2"'))
    caja(10, 120, 112, 46, "Cliente", "app · panel · curl", INK1)
    caja(156, 120, 124, 46, "nginx", "https://localhost", LIME_SUAVE)
    caja(300, 120, 104, 46, "gateway", ":3000", LIME)
    s.append(camino("M122,143 L154,143", INK, 1.2))
    s.append(camino("M280,143 L298,143", INK, 1.2))
    servicios = [("svc-users", ":3001"), ("svc-shipments", ":3002"), ("svc-payments", ":3003"),
                 ("svc-admin", ":3004"), ("svc-pricing", ":3005")]
    for i, (nom, p) in enumerate(servicios):
        y = 44 + i * 46
        caja(440, y, 122, 38, nom, p)
        s.append(camino(f"M404,143 C420,143 420,{y + 19} 438,{y + 19}", INK, 1))
    caja(596, 72, 96, 46, "PostgreSQL", ":5432", INK1)
    caja(596, 174, 96, 46, "Redis", ":6379", INK1)
    for i in range(5):
        y = 44 + i * 46 + 19
        s.append(linea(562, y, 578, y, INK4, 0.8))
    s.append(linea(578, 63, 578, 247, INK4, 0.8))
    s.append(camino("M578,95 L594,95", INK4, 0.8, "", "flg"))
    s.append(camino("M578,197 L594,197", INK4, 0.8, "", "flg"))
    s.append(t(352, 186, "Swagger en /docs", 7.8, 400, INK6))
    s.append(t(352, 197, "de cada servicio Node", 7.8, 400, INK6))
    s.append(t(66, 190, "todos los puertos", 7.8, 400, INK6))
    s.append(t(66, 201, "quedan publicados", 7.8, 400, INK6))
    s.append(t(66, 212, "en localhost", 7.8, 400, INK6))
    guardar("inst-puertos", W, H, s, flecha_defs(INK) + flecha_defs(INK4, "flg"))


if __name__ == "__main__":
    plazos()
    estados_envio()
    estados_oferta()
    cancelacion()
    puertos()
