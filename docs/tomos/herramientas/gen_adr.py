#!/usr/bin/env python3
"""Imprime el índice vigente de los ADR a partir de docs/adr/README.md del repositorio."""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]


def main() -> None:
    txt = (RAIZ / "docs" / "adr" / "README.md").read_text(encoding="utf-8")
    filas = [l for l in txt.splitlines() if re.match(r"^\| \d{3} \|", l)]
    out = ["# Registro de Decisiones de Arquitectura\n"]
    out.append(
        "Las decisiones de arquitectura se registran como *Architecture Decision Records* (ADR): cada una documenta el contexto, "
        "la decisión y el costo que el equipo aceptó. Un ADR aceptado no se modifica; si una decisión cambia, se crea uno nuevo que "
        "referencia y deprecia al anterior. La tabla siguiente es el índice vigente del repositorio, con una fila por ADR.\n"
    )
    out.append(
        "::: pendiente\n**Pendiente de incorporar.** El desarrollo completo de los ADR del Sprint 0 (contexto, alternativas consideradas y "
        "justificación) está siendo reescrito por el equipo y se integrará a este documento cuando esté listo. Hasta entonces, este índice "
        "resume la decisión y el costo aceptado de cada uno.\n:::\n"
    )
    out.append("| ADR | Decisión | Costo aceptado |\n|-----|------------------------------------------------------|--------------------------------------|")
    for f in filas:
        celdas = [c.strip() for c in f.strip().strip("|").split("|")]
        if len(celdas) >= 3:
            out.append(f"| {celdas[0]} | {celdas[1]} | {'|'.join(celdas[2:])} |")
    out.append("\n: Índice de ADR vigentes.\n")
    print("\n".join(out))


if __name__ == "__main__":
    main()
