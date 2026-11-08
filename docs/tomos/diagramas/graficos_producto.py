#!/usr/bin/env python3
"""Gráficos del Tomo II (registro de decisiones): curva de precios (DD-041) y plazos del hold (DD-050).

La curva replica `price_components` de `services/movo-svc-pricing-logistics/app/services/pricing.py`
(`package_tapered_v3`) con los valores por defecto de `app/config.py`. Si cambian los coeficientes,
actualizar `PRICING` acá.
"""
from svg_comun import (BLANCO, INK, INK1, INK2, INK4, INK6, LIME, LIME_SUAVE, camino, circulo, flecha_defs,
                       guardar, linea, num, rect, t)

PRICING = {  # defaults de app/config.py
    "base_fare_l": 0.15, "base_fare_document_l": 0.0, "fuel_l_per_km": 0.08, "fuel_cost_share": 0.6,
    "non_fuel_l_per_km": 0.02, "per_kg_l": 0.275, "weight_tier_kg": 10.0, "weight_tier_rate": 0.35,
    "distance_tier1_km": 30.0, "distance_tier2_km": 300.0, "distance_tier2_rate": 0.2,
    "distance_tier3_rate": 0.015, "fuel_price_fallback_ars_per_l": 2222.5,
}


def km_efectivos(d):
    c = PRICING
    t1, t2 = c["distance_tier1_km"], c["distance_tier2_km"]
    return min(d, t1) + max(min(d, t2) - t1, 0) * c["distance_tier2_rate"] + max(d - t2, 0) * c["distance_tier3_rate"]


def kg_efectivos(kg):
    c = PRICING
    return min(kg, c["weight_tier_kg"]) + max(kg - c["weight_tier_kg"], 0) * c["weight_tier_rate"]


def precio(d, kg, documento=False):
    """Subtotal sin recargo por demanda, redondeado a $10 como la cotización."""
    c = PRICING
    p = c["fuel_price_fallback_ars_per_l"]
    por_km = (c["fuel_l_per_km"] * c["fuel_cost_share"] + c["non_fuel_l_per_km"]) * p
    base = (c["base_fare_document_l"] if documento else c["base_fare_l"]) * p
    v = base + km_efectivos(d) * por_km + kg_efectivos(kg) * c["per_kg_l"] * p
    return round(v / 10) * 10


def pricing() -> None:
    W, H = 740, 330
    x0, x1, y0, y1 = 80, 560, 30, 268
    dmax, pmax = 1500, 30000

    def X(d):
        return x0 + d / dmax * (x1 - x0)

    def Y(v):
        return y1 - v / pmax * (y1 - y0)

    s = []
    for v in range(0, pmax + 1, 5000):
        s.append(linea(x0, Y(v), x1, Y(v), INK2, 0.6))
        s.append(t(x0 - 8, Y(v) + 3, f"$ {num(v)}", 8, color=INK4, anchor="end", mono=True))
    for d in range(0, dmax + 1, 250):
        s.append(t(X(d), y1 + 14, f"{num(d)} km", 8, color=INK4, mono=True))
    s.append(t((x0 + x1) / 2, y1 + 32, "Distancia por ruta entre retiro y entrega", 8.6, color=INK6))
    # Tramos de distancia
    for d, lab in ((30, "30 km"), (300, "300 km")):
        s.append(linea(X(d), y0, X(d), y1, INK4, 0.9, "3 3"))
    s.append(t(X(30) - 3, y0 + 22, "100 %", 7.6, 700, INK6, "end"))
    s.append(t(X(165), y0 + 22, "20 % por km", 7.6, 700, INK6))
    s.append(t(X(900), y0 + 22, "1,5 % por km", 7.6, 700, INK6))
    series = [("20 kg facturables", 20, False, INK, 2.2), ("5 kg", 5, False, INK, 1.6),
              ("1 kg", 1, False, INK, 1.2), ("Documento (0,2 kg)", 0.2, True, INK4, 1.2)]
    ult = -1e9
    for i, (nom, kg, doc, col, sw) in enumerate(series):
        pts = [(X(d), Y(precio(d, kg, doc))) for d in range(0, dmax + 1, 5)]
        dash = 'stroke-dasharray="5 3"' if doc else ""
        s.append(f'<polyline points="{" ".join(f"{x:.1f},{y:.1f}" for x, y in pts)}" fill="none" '
                 f'stroke="{col}" stroke-width="{sw}" {dash}/>')
        vf = precio(dmax, kg, doc)
        ye = max(Y(vf), ult + 28)  # etiquetas apiladas sin pisarse
        ult = ye
        s.append(linea(x1 + 2, Y(vf), x1 + 8, ye - 3, col, 0.8))
        s.append(t(x1 + 12, ye, f"{nom}", 8.6, 700, col, "start"))
        s.append(t(x1 + 12, ye + 11, f"$ {num(vf)} a 1.500 km", 7.8, 400, INK6, "start", True))
    # Un punto de referencia: 1 kg a 300 km
    v = precio(300, 1)
    s.append(circulo(X(300), Y(v), 4.5, LIME, INK, 1.2))
    s.append(t(X(300) + 8, Y(v) + 16, f"1 kg a 300 km: $ {num(v)}", 8, 600, anchor="start", mono=True))
    guardar("dd-pricing", W, H, s)


def hold() -> None:
    W, H = 740, 230
    x0, x1 = 200, 710
    dias = 5

    def X(d):
        return x0 + d / dias * (x1 - x0)

    s = []
    for d in range(dias + 1):
        s.append(linea(X(d), 30, X(d), 178, INK2, 0.6))
        s.append(t(X(d), 194, f"día {d}", 8.2, color=INK4, mono=True))
    s.append(t((x0 + x1) / 2, 212, "Días desde que se crea el hold (pago del emisor)", 8.6, color=INK6))
    # Vigencia del hold
    s.append(rect(X(0), 30, X(5) - X(0), 22, LIME_SUAVE, INK, 1, 4))
    s.append(t(X(2.5), 45, "Vigencia del hold en Mercado Pago · MP_HOLD_VALIDITY_DAYS = 5", 8.6, 700))
    filas = [
        ("Retiro cercano, peor caso", "paga al aceptar: retiro a 3 días",
         [(0, 3, INK1, "espera del retiro (N = 3)"), (3, 4, INK2, "tránsito"), (4, 5, BLANCO, "margen")]),
        ("Retiro lejano", "paga hasta 24 h antes del retiro",
         [(0, 1, INK1, "24 h"), (1, 2, INK2, "tránsito"), (2, 5, BLANCO, "margen de 3 días")]),
    ]
    for i, (nom, sub, tramos) in enumerate(filas):
        y = 76 + i * 54
        s.append(t(x0 - 12, y + 10, nom, 9.2, 700, anchor="end"))
        s.append(t(x0 - 12, y + 22, sub, 7.8, color=INK6, anchor="end"))
        for a, b, fill, lab in tramos:
            dash = 'stroke-dasharray="3 2"' if fill == BLANCO else ""
            s.append(rect(X(a), y, X(b) - X(a), 26, fill, INK, 1, 0, dash))
            s.append(t((X(a) + X(b)) / 2, y + 17, lab, 8.2, 600, INK if fill != BLANCO else INK6))
        for a, _, _, _ in tramos[1:]:
            s.append(circulo(X(a), y + 13, 3.5, INK, INK))
        s.append(t(X(tramos[0][1]), y - 4, "retiro", 7.6, 600, INK6))
        s.append(t(X(tramos[1][1]), y - 4, "entrega", 7.6, 600, INK6))
    guardar("dd-hold", W, H, s, flecha_defs(INK))


if __name__ == "__main__":
    pricing()
    hold()
