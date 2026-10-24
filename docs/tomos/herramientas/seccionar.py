"""Divide un diagrama de secuencia PlantUML en partes, una por cada separador `== título ==`.

Un diagrama de secuencia completo con 8 o 9 participantes queda ilegible al achicarlo al ancho de
una página A4. Cada parte conserva solo los participantes que usa y continúa la numeración de
mensajes de la anterior, de modo que las partes se leen como un único diagrama.
"""
import re

PARTICIPANTE = re.compile(r'^(actor|participant|database|entity|boundary|control|queue|collections)\s+"?(.+?)"?\s+as\s+(\w+)')
SECCION = re.compile(r"^==\s*(.+?)\s*==\s*$")
MENSAJE = re.compile(r"-+>|<-+")


def partes(texto: str, nombre: str) -> list[tuple[str, str]]:
    """Devuelve [(título, fuente PlantUML)] o [] si el diagrama no se divide."""
    lineas = texto.splitlines()
    if not lineas or not lineas[0].startswith("@startuml"):
        return []
    cuerpo = [l for l in lineas[1:] if not l.startswith("@enduml")]
    idx = [i for i, l in enumerate(cuerpo) if SECCION.match(l.strip())]
    if len(idx) < 2:
        return []
    previo = cuerpo[: idx[0]]
    decl = [(PARTICIPANTE.match(l.strip()), l) for l in previo]
    participantes = [(m.group(3), l) for m, l in decl if m]
    resto = [l for m, l in decl if not m and l.strip() and l.strip() != "autonumber"]
    limites = idx + [len(cuerpo)]
    salida = []
    for n, (a, b) in enumerate(zip(limites, limites[1:]), 1):
        trozo = cuerpo[a:b]
        titulo = SECCION.match(trozo[0].strip()).group(1)
        usados = {alias for alias, _ in participantes if any(re.search(rf"\b{alias}\b", l) for l in trozo[1:] if not l.strip().startswith("'"))}
        previos = sum(1 for l in cuerpo[idx[0] : a] if MENSAJE.search(l) and ":" in l and not l.strip().startswith(("'", "note")))
        fuente = [f"@startuml {nombre}-{n}"] + resto
        fuente.append(f"autonumber {previos + 1}")
        fuente += [l for alias, l in participantes if alias in usados]
        fuente += trozo
        fuente.append("@enduml")
        salida.append((titulo, "\n".join(fuente) + "\n"))
    return salida
