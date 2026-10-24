#!/usr/bin/env python3
"""Genera el listado vigente de épicas e historias de usuario (Tomo II, documento 1).

Fuentes: datos/historias.json (export de Linear), datos/hu-ep0N.yaml (qué historias componen cada
tema) y las tablas del Sprint 0 (estimación inicial por épica).
"""
import json
import sys
from collections import Counter
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gen_tema import ESTADOS, esc, sprints_de  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
DATOS = RAIZ / "datos"

# (id, nombre, historias del Sprint 0, MVP, horas, horas MVP, prioridad, habilitadoras)
EPICAS = [
    ("EP-01", "Identidad y Confianza", 6, 4, 66, 52, "Alta", ["MOVO-66", "MOVO-67", "MOVO-68", "MOVO-69"]),
    ("EP-02", "Publicación y Descubrimiento", 6, 5, 64, 56, "Alta", []),
    ("EP-03", "Asignación y Negociación", 2, 2, 18, 18, "Alta", []),
    ("EP-04", "Ejecución del Envío", 6, 5, 92, 78, "Alta", []),
    ("EP-05", "Pagos y Economía", 4, 2, 42, 28, "Alta", []),
    ("EP-06", "Reputación y Comunidad", 3, 3, 24, 24, "Media", []),
    ("EP-07", "Gestión y Administración", 5, 3, 46, 28, "Media", []),
]

GRUPOS = [
    ("Infraestructura, CI/CD y base técnica", ["MOVO-43", "MOVO-44", "MOVO-53", "MOVO-54", "MOVO-59", "MOVO-114", "MOVO-115", "MOVO-122", "MOVO-156", "MOVO-232", "MOVO-241", "MOVO-267", "MOVO-91", "MOVO-92", "MOVO-93"]),
    ("Modelo de datos e integraciones iniciales", ["MOVO-41", "MOVO-42", "MOVO-46", "MOVO-51", "MOVO-57", "MOVO-58", "MOVO-60", "MOVO-48", "MOVO-49", "MOVO-50", "MOVO-216", "MOVO-217", "MOVO-218", "MOVO-219", "MOVO-264"]),
    ("Evolución de funcionalidades existentes", ["MOVO-116", "MOVO-117", "MOVO-167", "MOVO-168", "MOVO-169", "MOVO-184", "MOVO-208", "MOVO-249", "MOVO-253", "MOVO-254", "MOVO-255", "MOVO-258", "MOVO-265", "MOVO-266", "MOVO-270", "MOVO-276", "MOVO-277", "MOVO-278", "MOVO-279", "MOVO-284", "MOVO-285", "MOVO-301", "MOVO-317", "MOVO-318", "MOVO-280", "MOVO-96"]),
    ("Correcciones de errores", ["MOVO-113", "MOVO-244", "MOVO-271", "MOVO-340"]),
    ("Gestión del proyecto y entregables académicos", ["MOVO-40", "MOVO-45", "MOVO-90", "MOVO-99", "MOVO-164", "MOVO-165", "MOVO-223", "MOVO-272", "MOVO-273"]),
]


def main() -> None:
    H = json.loads((DATOS / "historias.json").read_text(encoding="utf-8"))
    temas = {}
    for n, ep in enumerate(EPICAS, 1):
        cfg = yaml.safe_load((DATOS / f"hu-ep0{n}.yaml").read_text(encoding="utf-8"))
        temas[ep[0]] = [h["id"] for h in cfg["historias"]]
    todos = [i for ids in temas.values() for i in ids]
    cuenta = Counter(H[i]["estado"] for i in todos)
    out = ["# Épicas e Historias de Usuario\n"]
    out.append(
        "El backlog de Movo se organiza en siete **épicas** alineadas con los contextos delimitados "
        "(*bounded contexts*) de la arquitectura de microservicios. Cada épica agrupa las historias de usuario "
        "de un mismo dominio funcional y da origen a un **tema** de este tomo: los siete documentos siguientes "
        "presentan, historia por historia, los criterios de aceptación, el diagrama de secuencia y los casos de prueba.\n"
    )
    out.append("## Resumen por épica\n")
    out.append("La estimación inicial proviene del Sprint 0 (32 historias, en horas lineales de desarrollo). Las columnas finales muestran el estado real de las historias que componen hoy cada épica, según Linear.\n")
    out.append("| ID | Épica | Historias iniciales | Horas iniciales | Historias hoy | Completadas | En curso o pendientes |\n|------|------------------------------|---------:|---------:|---------:|----------:|-----------:|")
    tot_i = tot_h = tot_n = tot_c = 0
    for ep in EPICAS:
        ids = temas[ep[0]]
        comp = sum(1 for i in ids if H[i]["estado"] == "Done")
        out.append(f"| {ep[0]} | {ep[1]} | {ep[2]} | {ep[4]} | {len(ids)} | {comp} | {len(ids) - comp} |")
        tot_i += ep[2]; tot_h += ep[4]; tot_n += len(ids); tot_c += comp
    out.append(f"| | **Total** | **{tot_i}** | **{tot_h}** | **{tot_n}** | **{tot_c}** | **{tot_n - tot_c}** |")
    out.append("\n: Resumen del backlog por épica.\n")
    out.append(
        f"El backlog creció de {tot_i} historias iniciales a {tot_n} historias agrupadas en los siete temas (algunas de enfoque técnico, como el modelo de la oferta o el motor de precios, que el equipo gestionó como historia): varias historias se "
        "subdividieron al refinarse (por ejemplo, la creación de envíos pasó a incluir cotización congelada, "
        "fotos y confirmación del receptor), y otras surgieron de necesidades que el Sprint 0 no había previsto "
        "(chat, transferencia de receptor, penalidades de cancelación, soporte, sanciones, acceso al panel con segundo factor). "
        f"De esas {tot_n} historias, {tot_c} están completas; el resto está en curso, por hacer o en backlog y se documenta con su estado real.\n"
    )
    for ep in EPICAS:
        out.append(f"## {ep[0]} · {ep[1]}\n")
        out.append("| Historia | Enunciado | Estado | Sprint | Tickets |\n|----------|--------------------------------------------------|------------|------------------|-------:|")
        for i in temas[ep[0]] + ep[7]:
            h = H[i]
            est, _ = ESTADOS.get(h["estado"], (h["estado"], ""))
            tit = h["titulo"]
            if not tit.startswith("Como"):
                tit = tit[0].upper() + tit[1:] if tit and not tit.startswith("[") else tit
            out.append(f"| `{i}` | {esc(tit)} | {est} | {sprints_de(h)} | {len(h['hijos'])} |")
        out.append(f"\n: Historias de la épica {ep[0]}.\n")
        if ep[7]:
            out.append("Las historias `MOVO-66` a `MOVO-69` son historias *habilitadoras* (las pide el equipo, no un usuario final): persistencia de usuarios, librería compartida, autenticación en el gateway y puesta a punto del testing automatizado.\n")
    out.append("## Trabajo técnico, de corrección y de gestión\n")
    out.append("Además de las historias de usuario, el tablero de Linear registra trabajo que no corresponde a una funcionalidad visible para el usuario: infraestructura, modelo de datos, investigaciones (*spikes*), evolución de funcionalidades ya entregadas, corrección de errores y entregables académicos. Se lista aquí para que el backlog quede completo; su trazabilidad está en los informes de cada sprint (Tomo I).\n")
    for titulo, ids in GRUPOS:
        out.append(f"### {titulo}\n")
        out.append("| Ticket | Descripción | Estado | Sprint |\n|----------|--------------------------------------------------------|------------|----------------------|")
        for i in ids:
            h = H.get(i)
            if not h:
                continue
            est, _ = ESTADOS.get(h["estado"], (h["estado"], ""))
            out.append(f"| `{i}` | {esc(h['titulo'])} | {est} | {sprints_de(h)} |")
        out.append(f"\n: {titulo}.\n")
    print("\n".join(out))


if __name__ == "__main__":
    main()
