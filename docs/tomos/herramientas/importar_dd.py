#!/usr/bin/env python3
"""Convierte "[Movo] 011-Registro de Decisiones de Diseño" (Markdown exportado de Drive) en contenido del Tomo II.

Uso: python3 herramientas/importar_dd.py <dd.md>   (escribe contenido/tomo-2/13b-decisiones-de-diseno/decisiones.md)
"""
import re
import sys
from pathlib import Path

DESTINO = Path(__file__).resolve().parents[1] / "contenido" / "tomo-2" / "13b-decisiones-de-diseno" / "decisiones.md"
ROTULO = {"CONTEXTO": "Contexto", "ALTERNATIVAS CONSIDERADAS": "Alternativas consideradas", "DECISIÓN": "Decisión",
          "CONSECUENCIAS": "Consecuencias", "REFERENCIAS": "Referencias"}


def estado(txt: str) -> str:
    txt = txt.replace("· redacción pendiente de revisión", "").strip(" ·")
    palabra, _, resto = txt.partition(" ")
    return f'<p class="adr-cab"><span class="chip lime">{palabra}</span> {resto.strip()}</p>'


def main(ruta: str) -> None:
    txt = Path(ruta).read_text(encoding="utf-8")
    cuerpo = txt[txt.index("\n## DD-"):]
    indice = re.findall(r"^DD-(\d{3}) — (.*)$", txt[: txt.index("\n## DD-")], re.M)
    out = ["# Registro de Decisiones de Diseño\n"]
    out.append(
        "Este registro reúne las decisiones de diseño de alcance acotado (las reglas de un módulo, el contrato de un endpoint, "
        "el ajuste de un comportamiento) que se tomaron durante los sprints y que no definen la arquitectura ni el stack del "
        "sistema. Por eso no forman parte del registro de ADR.\n"
    )
    out.append(
        "Cada decisión lleva el prefijo **DD** y conserva el número que tenía cuando se registró como ADR, para que las "
        "referencias existentes en el código, en los tickets y en los demás documentos sigan siendo válidas: un «ADR» anterior "
        "con uno de estos números se lee como DD con el mismo número. Los ADR vigentes están en el documento de Arquitectura "
        "del Sistema y se numeran del 001 al 023.\n"
    )
    out.append("## Índice de decisiones de diseño\n")
    out.append("| DD | Decisión |\n|--------|------------------------------------------------------------|")
    for n, t in indice:
        out.append(f"| DD-{n} | {t.strip()} |")
    out.append(f"\n: Índice de las {len(indice)} decisiones de diseño.\n")
    for bloque in re.split(r"\n(?=## DD-)", cuerpo.strip()):
        lineas = bloque.strip().split("\n")
        m = re.match(r"## (DD-\d{3})\s+(.*)", lineas[0])
        out.append(f"## {m.group(1)} · {m.group(2).strip()}\n")
        resto = "\n".join(lineas[1:])
        resto = re.sub(r"^Estado: (.*)$", lambda e: estado(e.group(1)), resto, flags=re.M)
        resto = re.sub(r"^### (.*)$", lambda e: f'<span class="dd-etq">{ROTULO.get(e.group(1).strip(), e.group(1).strip().capitalize())}</span>\n', resto, flags=re.M)
        resto = re.sub(r"^(Situación|Alcance|Decisión tomada|Trade-offs|Criterios|Referencias|Alternativa \d+):", r"**\1:**", resto, flags=re.M)
        out.append(resto.strip() + "\n")
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text("\n".join(out), encoding="utf-8")
    print(f"{len(indice)} DD -> {DESTINO}")


if __name__ == "__main__":
    main(sys.argv[1])
