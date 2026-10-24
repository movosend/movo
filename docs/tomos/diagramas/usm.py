#!/usr/bin/env python3
"""User Story Map de Movo (Sprint 0): actividades del usuario, tareas por actividad y corte de MVP.

Las tareas y su pertenencia al MVP salen del backlog inicial (contenido/tomo-1/06-user-story-mapping).
"""
import os
from pathlib import Path
from xml.sax.saxutils import escape

INK, INK6, INK4, INK2, INK1, INK05, LIME = "#0A0A0B", "#3A3A40", "#8A8A93", "#D9D9DE", "#F1F1F3", "#F8F8F9", "#C6F24A"
FONT = "Inter, sans-serif"

# (actividad, [(tarea, historia, mvp)])
ACTIVIDADES = [
    ("Incorporarse a la plataforma", [
        ("Registrarse", "MOVO-7", True), ("Completar KYC", "MOVO-7", True),
        ("Verificar licencia (transportista)", "MOVO-15", True), ("Configurar método de pago", "MOVO-15", True),
        ("Ver perfil", "MOVO-14", True), ("Editar perfil", "MOVO-31", False), ("Solicitar la baja de la cuenta", "MOVO-39", False)]),
    ("Publicar un envío", [
        ("Crear envío con datos del paquete", "MOVO-8", True), ("Designar receptor", "MOVO-8", True),
        ("Confirmar o rechazar envío (receptor)", "MOVO-16", True), ("Cancelar envío publicado", "MOVO-29", True)]),
    ("Encontrar trabajo (transportista)", [
        ("Declarar viaje", "MOVO-18", True), ("Ver paquetes disponibles", "MOVO-19", True),
        ("Filtrar por ruta declarada", "MOVO-20", False)]),
    ("Negociar y asignarse", [
        ("Ofertar o contraofertar", "MOVO-23", True), ("Elegir transportista (emisor)", "MOVO-17", True),
        ("Reservar fondos (hold)", "MOVO-12", True)]),
    ("Ejecutar el envío", [
        ("Navegar ruta optimizada", "MOVO-10", True), ("Registrar fotos al retirar y entregar", "MOVO-21", True),
        ("Ejecutar handshake de retiro y entrega", "MOVO-6", True), ("Trackear ubicación en tiempo real", "MOVO-11", True),
        ("Recibir notificaciones push", "MOVO-24", True), ("Comunicarse por chat", "MOVO-26", False)]),
    ("Cerrar la transacción", [
        ("Procesar split payment automático", "MOVO-13", True), ("Calificar a las otras partes", "MOVO-22", True),
        ("Ver score de reputación", "MOVO-25", True), ("Ver historial de envíos", "MOVO-27", True),
        ("Ver historial de pagos", "MOVO-28", False), ("Pagar la comisión en efectivo", "MOVO-37", False)]),
    ("Resolver problemas", [
        ("Abrir una disputa", "MOVO-30", True), ("Gestionar disputa (admin)", "MOVO-34", True)]),
    ("Administrar la plataforma", [
        ("Revisar casos KYC manuales", "MOVO-32", True), ("Suspender cuentas", "MOVO-36", True),
        ("Monitorear envíos activos", "MOVO-33", False), ("Ver métricas operativas", "MOVO-35", False)]),
]

CW, GAP, CH, CG, X0, Y0 = 118, 6, 44, 6, 14, 14


def partir(texto, ancho=21):
    palabras, lineas, actual = texto.split(), [], ""
    for p in palabras:
        if len(actual) + len(p) + 1 > ancho and actual:
            lineas.append(actual)
            actual = p
        else:
            actual = (actual + " " + p).strip()
    lineas.append(actual)
    return lineas[:3]


def t(x, y, s, size=8.6, weight=400, color=INK, anchor="start"):
    return f'<text x="{x}" y="{y}" font-family="{FONT}" font-size="{size}" font-weight="{weight}" fill="{color}" text-anchor="{anchor}">{escape(s)}</text>'


def main() -> None:
    n = len(ACTIVIDADES)
    ancho = X0 * 2 + n * CW + (n - 1) * GAP
    max_mvp = max(sum(1 for _, _, m in tareas if m) for _, tareas in ACTIVIDADES)
    max_no = max(sum(1 for _, _, m in tareas if not m) for _, tareas in ACTIVIDADES)
    y_cab = Y0
    h_cab = 50
    y_tar = y_cab + h_cab + 14
    y_corte = y_tar + max_mvp * (CH + CG) + 8
    alto = y_corte + 22 + max_no * (CH + CG) + 14
    s = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{ancho}" height="{alto}" viewBox="0 0 {ancho} {alto}">']
    for i, (act, tareas) in enumerate(ACTIVIDADES):
        x = X0 + i * (CW + GAP)
        s.append(f'<rect x="{x}" y="{y_cab}" width="{CW}" height="{h_cab}" rx="7" fill="{INK}"/>')
        s.append(t(x + 9, y_cab + 14, f"{i + 1:02d}", 8, 600, LIME))
        for j, l in enumerate(partir(act, 20)):
            s.append(t(x + 9, y_cab + 28 + j * 11, l, 9.4, 600, "#FFFFFF"))
        mvp = [x_ for x_ in tareas if x_[2]]
        resto = [x_ for x_ in tareas if not x_[2]]
        for k, (tarea, hu, _) in enumerate(mvp):
            y = y_tar + k * (CH + CG)
            s.append(f'<rect x="{x}" y="{y}" width="{CW}" height="{CH}" rx="5" fill="#FFFFFF" stroke="{INK}" stroke-width="1"/>')
            s.append(f'<rect x="{x}" y="{y}" width="3.4" height="{CH}" rx="1.6" fill="{LIME}"/>')
            for j, l in enumerate(partir(tarea)):
                s.append(t(x + 9, y + 13 + j * 10.6, l, 8.4, 500))
            s.append(t(x + 9, y + CH - 5, hu, 7.2, 600, INK4))
        for k, (tarea, hu, _) in enumerate(resto):
            y = y_corte + 22 + k * (CH + CG)
            s.append(f'<rect x="{x}" y="{y}" width="{CW}" height="{CH}" rx="5" fill="{INK05}" stroke="{INK2}" stroke-width="1"/>')
            for j, l in enumerate(partir(tarea)):
                s.append(t(x + 9, y + 13 + j * 10.6, l, 8.4, 400, INK6))
            s.append(t(x + 9, y + CH - 5, hu, 7.2, 600, INK4))
    s.append(f'<line x1="{X0}" y1="{y_corte}" x2="{ancho - X0}" y2="{y_corte}" stroke="{INK}" stroke-width="1.2" stroke-dasharray="5 4"/>')
    s.append(t(X0, y_corte + 15, "CORTE DE MVP  ·  por encima: funcionalidad mínima para validar con usuarios reales  ·  por debajo: posterior al MVP", 7.6, 600, INK6))
    s.append("</svg>")
    destino = Path(os.environ.get("DIAG_OUT", Path(__file__).parent)) / "usm.svg"
    destino.write_text("\n".join(s), encoding="utf-8")


if __name__ == "__main__":
    main()
