#!/usr/bin/env python3
"""Imprime el Registro de Decisiones de Arquitectura (ADR) a partir de datos/adr.json.

El JSON lo produce herramientas/importar_adr.py desde el documento de Sprint 0 de Drive. Cada ADR se maqueta como
una ficha: estado, contexto, criterios, alternativas, decisión y consecuencias.
"""
import json
import re
from html import escape
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]

# Numeración anterior (la de docs/adr hasta el 24/10/2026) de los ADR que se corrieron al recortar el registro a 23.
ANTES = {"016": "017", "017": "019", "018": "020", "019": "022", "020": "024", "021": "025", "022": "035", "023": "040"}
ROTULO = {
    "contexto": "Contexto",
    "criterios": "Criterios de comparación",
    "alternativas": "Alternativas consideradas",
    "decision": "Decisión",
    "consecuencias": "Consecuencias",
    "referencias": "Referencias",
}
# ADR cuyo texto quedó parcialmente superado por otro: la nota se muestra junto al estado, sin modificar el ADR aceptado.
ACTUALIZADO_POR = {
    "ADR-004": "El plazo del refresh token (7 días) fue reemplazado por 90 días en el ADR-013.",
    "ADR-005": "La mención de Socket.io fue reemplazada por WebSocket nativo en el ADR-019.",
}
PREFIJOS = ("Pros:", "Contras:", "Positivo:", "Trade-off negativo:", "Negativo:", "Trade-off:")


def inline(txt: str) -> str:
    """Escapa el texto y resalta los prefijos de ventaja/costo y las marcas de opción elegida."""
    t = escape(txt)
    for p in PREFIJOS:
        if t.startswith(p):
            t = f"<b>{p}</b>" + t[len(p):]
    t = re.sub(r"^(Opción [A-Z]:|Alternativa \d+:)", r"<b>\1</b>", t)
    t = re.sub(r"\((ELEGIDA)\)", r'<span class="chip lime">elegida</span>', t)
    t = re.sub(r"(?<![\w/])`?(MOVO-\d+)`?", r"\1", t)
    return t


def bloque(parrafos: list[str]) -> str:
    """Agrupa viñetas y pasos numerados consecutivos en listas; el resto son párrafos."""
    out, abierta = [], None
    for p in parrafos:
        m_b = re.match(r"^[•\-–] (.*)", p)
        m_n = re.match(r"^(\d+)[.)] (.*)", p)
        tipo, cuerpo = ("ul", m_b.group(1)) if m_b else (("ol", m_n.group(2)) if m_n else (None, p))
        if tipo != abierta:
            if abierta:
                out.append(f"</{abierta}>")
            if tipo:
                out.append(f"<{tipo}>")
            abierta = tipo
        out.append(f"<li>{inline(cuerpo)}</li>" if tipo else f"<p>{inline(cuerpo)}</p>")
    if abierta:
        out.append(f"</{abierta}>")
    return "".join(out)


def tabla_alternativas(parrafos: list[str]) -> str | None:
    """Una fila de alternativas escrita como 'Alternativa | Por qué no' se maqueta como tabla."""
    if not parrafos or " | " not in parrafos[0]:
        return None
    filas = [[c.strip() for c in p.split(" | ", 1)] for p in parrafos if " | " in p]
    cab, cuerpo = filas[0], filas[1:]
    return (
        "<table class=\"compacta\"><thead><tr>" + "".join(f"<th>{escape(c)}</th>" for c in cab) + "</tr></thead><tbody>"
        + "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in f) + "</tr>" for f in cuerpo)
        + "</tbody></table>"
    )


def estado_html(estado: str) -> str:
    estado = estado.replace("· redacción pendiente de revisión", "").strip(" ·")
    base = re.match(r"([A-Za-zÁÉÍÓÚáéíóú]+)(.*)", estado)
    palabra, resto = (base.group(1), base.group(2).strip()) if base else (estado, "")
    clase = "lime" if palabra == "Aceptado" else ""
    return f'<span class="chip {clase}">{escape(palabra)}</span>' + (f' <span class="adr-estado-nota">{escape(resto.strip(" ()"))}</span>' if resto else "")


def ficha(a: dict) -> str:
    filas = []
    for s in a["secciones"]:
        filas.append(f'<div class="adr-sec"><span class="adr-rotulo">{ROTULO[s["clave"]]}</span>')
        for f in s["filas"]:
            etiqueta = f["etiqueta"]
            if s["clave"] == "alternativas":
                cuerpo = tabla_alternativas(f["parrafos"]) or bloque(f["parrafos"])
                filas.append(f'<div class="adr-fila"><div class="adr-etq">{escape(etiqueta)}</div><div class="adr-cuerpo">{cuerpo}</div></div>')
            else:
                filas.append(f'<div class="adr-fila"><div class="adr-etq">{escape(etiqueta)}</div><div class="adr-cuerpo">{bloque(f["parrafos"])}</div></div>')
        filas.append("</div>")
    aviso = f'<p class="adr-aviso">{escape(ACTUALIZADO_POR[a["id"]])}</p>' if a["id"] in ACTUALIZADO_POR else ""
    return f'<div class="adr"><div class="adr-cab">{estado_html(a["estado"])}</div>{aviso}{"".join(filas)}</div>'


def main() -> None:
    adrs = json.loads((RAIZ / "datos" / "adr.json").read_text(encoding="utf-8"))
    out = ["# Registro de Decisiones de Arquitectura\n"]
    out.append(
        "Los *Architecture Decision Records* (ADR) documentan cada decisión técnica significativa: el contexto que la motivó, "
        "las alternativas evaluadas con criterios explícitos, la decisión tomada y sus consecuencias, incluidos los costos que "
        "el equipo aceptó de forma consciente. Se mantienen **23 ADR**, numerados del 001 al 023, que fijan el stack, un "
        "proveedor o una integración, la estructura entre servicios o el modelo de seguridad. Un ADR aceptado no se modifica: si "
        "la decisión cambia, se crea uno nuevo que referencia y depreca al anterior.\n"
    )
    out.append(
        "Las decisiones de alcance acotado (la regla de un módulo, el contrato de un endpoint, un parámetro) no son ADR: "
        "están en el Registro de Decisiones de Diseño, con el prefijo **DD** y el número que tenían originalmente.\n"
    )
    out.append("## Índice de ADR\n")
    out.append("| ADR | Decisión | Estado | Núm. anterior |\n|-------------|---------------------------------------------|--------------|---------|")
    for a in adrs:
        est = re.sub(r"\s*·.*$", "", a["estado"])
        if a["id"] in ACTUALIZADO_POR:
            est += " (actualizado por " + re.search(r"ADR-\d+", ACTUALIZADO_POR[a["id"]].split(" en el ")[-1]).group(0) + ")"
        out.append(f"| {a['id']} | {a['titulo']} | {est} | {ANTES.get(a['numero'], '–')} |")
    out.append("\n: Índice de los ADR vigentes.\n")
    out.append(
        "La columna *Núm. anterior* indica el número con el que estas decisiones se registraron antes de depurar el registro a 23 ADR; "
        "los ADR 001 a 015 conservan su número. Las referencias a un número anterior que hoy corresponde a un DD se leen con el prefijo DD.\n"
    )
    for a in adrs:
        out.append(f"## {a['id']} · {a['titulo']}\n")
        out.append(ficha(a).replace("\n", " ") + "\n")
    print("\n".join(out))


if __name__ == "__main__":
    main()
