#!/usr/bin/env python3
"""Genera los diagramas de estados del envío y de la oferta leyendo sus máquinas de estados del código.

El grafo de transiciones (`VALID_TRANSITIONS`) y el comentario de cada arista salen de
`shipment-state-machine.ts` y `offer-state-machine.ts`, que son la única fuente de verdad: si el
código cambia, el diagrama cambia con él.
"""
import os
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SALIDA = Path(os.environ.get("DIAG_GEN", Path(__file__).parent / "_generados"))
DOM = REPO / "services" / "movo-svc-shipments" / "src" / "domain"


def parsear(archivo: Path, enum: str) -> tuple[list[tuple[str, str, str]], list[str]]:
    txt = archivo.read_text(encoding="utf-8")
    bloque = re.search(r"const VALID_TRANSITIONS[^=]*=\s*\{(.*?)\n\};", txt, re.S).group(1)
    aristas, estados = [], []
    for m in re.finditer(rf"\[{enum}\.(\w+)\]:\s*new Set\((?:\[(.*?)\])?\)", bloque, re.S):
        origen = m.group(1).lower()
        estados.append(origen)
        for linea in (m.group(2) or "").splitlines():
            t = re.match(rf"\s*{enum}\.(\w+),?\s*(?://\s*(.*))?", linea)
            if t:
                aristas.append((origen, t.group(1).lower(), re.sub(r"\s*\([^()]*(?:MOVO|AC\d)[^()]*\)", "", t.group(2) or "").strip(" ,.;:")))
    return aristas, estados


def etiqueta(texto: str, ancho: int = 28) -> str:
    palabras, lineas, actual = texto.split(), [], ""
    for p in palabras:
        if actual and len(actual) + len(p) + 1 > ancho:
            lineas.append(actual)
            actual = p
        else:
            actual = (actual + " " + p).strip()
    if actual:
        lineas.append(actual)
    return "\\n".join(lineas)


ETIQUETAS_ENVIO = {
    ("awaiting_receiver_confirmation", "published"): "el receptor acepta",
    ("awaiting_receiver_confirmation", "rejected_by_receiver"): "el receptor rechaza",
    ("awaiting_receiver_confirmation", "cancelled"): "el emisor cancela",
    ("published", "assignment_pending"): "oferta aceptada,\nretiro cercano",
    ("published", "assigned_unfunded"): "oferta aceptada,\nretiro lejano",
    ("published", "cancelled"): "el emisor cancela",
    ("assignment_pending", "published"): "pago fallido\no vencido",
    ("assignment_pending", "assigned"): "fondos reservados",
    ("assignment_pending", "cancelled"): "el emisor cancela",
    ("assigned_unfunded", "assigned"): "el emisor paga\nen la ventana",
    ("assigned_unfunded", "published"): "sin pago a T-24 h",
    ("assigned_unfunded", "cancelled"): "el emisor cancela",
    ("assigned", "in_transit"): "retiro confirmado\n(handshake)",
    ("assigned", "assigned_unfunded"): "Mercado Pago cancela\no vence el hold",
    ("assigned", "published"): "el transportista\nse baja",
    ("assigned", "cancelled"): "el emisor cancela\n(con penalidad)",
    ("assigned", "disputed"): "retiro no realizado\n(evidencia GPS)",
    ("in_transit", "delivered"): "entrega confirmada\n(handshake)",
    ("in_transit", "disputed"): "reclamo en tránsito",
    ("delivered", "completed"): "captura y split\nacreditados",
    ("delivered", "disputed"): "reclamo post-entrega",
    ("completed", "disputed"): "reclamo dentro\nde 7 días",
    ("rejected_by_receiver", "awaiting_receiver_confirmation"): "el emisor elige\notro receptor",
    ("rejected_by_receiver", "cancelled"): "el emisor cancela\no vence el plazo",
}
ETIQUETAS_OFERTA = {
    ("pending", "accepted"): "el emisor la elige",
    ("pending", "rejected"): "el emisor la rechaza",
    ("pending", "withdrawn"): "el transportista\nla retira",
    ("pending", "superseded"): "el emisor elige\notra oferta",
    ("pending", "shipment_cancelled"): "el envío se cancela",
    ("accepted", "shipment_cancelled"): "el envío se cancela",
    ("accepted", "assignment_lapsed"): "el pago no prospera",
    ("accepted", "carrier_withdrawn"): "el transportista\nse baja",
}


def escribir(ident: str, enum: str, archivo: str, inicial: str, etiquetas: dict) -> None:
    aristas, estados = parsear(DOM / archivo, enum)
    lineas = [f"@startuml {ident}", "hide empty description", "skinparam linetype spline", "skinparam ArrowFontSize 9", "skinparam nodesep 50", "skinparam ranksep 50"]
    if enum == "ShipmentStatus":
        lineas.append("left to right direction")
    for e in estados:
        sal = [a for a in aristas if a[0] == e]
        if not sal:
            lineas.append(f"state {e} <<terminal>>")
    lineas.append(f"[*] --> {inicial}")
    if enum == "OfferStatus":  # `expired` no es una arista persistida: se deriva en lectura a partir de expires_at
        lineas.append("pending --> expired : vence expires_at\\n(se deriva al leer)")
    for o, d, t in aristas:
        txt = etiquetas.get((o, d), etiqueta(t)).replace("\n", "\\n")
        lineas.append(f"{o} --> {d}" + (f" : {txt}" if txt else ""))
    for e in estados:
        if not [a for a in aristas if a[0] == e]:
            lineas.append(f"{e} --> [*]")
    lineas.append("@enduml")
    (SALIDA / f"{ident}.puml").write_text("\n".join(lineas) + "\n", encoding="utf-8")


def main() -> None:
    SALIDA.mkdir(parents=True, exist_ok=True)
    escribir("estados-envio", "ShipmentStatus", "shipment-state-machine.ts", "awaiting_receiver_confirmation", ETIQUETAS_ENVIO)
    escribir("estados-oferta", "OfferStatus", "offer-state-machine.ts", "pending", ETIQUETAS_OFERTA)


if __name__ == "__main__":
    main()
