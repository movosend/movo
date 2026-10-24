"""Lectura mínima de un schema.prisma: modelos, columnas, claves y relaciones.

Alcanza para generar el DER y el diccionario de datos a partir del esquema real de cada servicio,
que es la fuente de verdad del modelo de datos (ADR-011).
"""
import re
from dataclasses import dataclass, field
from pathlib import Path

ESCALARES = {"String", "Int", "BigInt", "Decimal", "Boolean", "DateTime", "Json", "Float", "Bytes"}


@dataclass
class Columna:
    nombre: str          # nombre en la base de datos (snake_case)
    campo: str           # nombre en el modelo Prisma
    tipo: str            # tipo legible (uuid, text, numeric, enum X, ...)
    obligatoria: bool
    pk: bool = False
    unica: bool = False
    fk: str | None = None      # modelo referenciado
    comentario: str = ""
    por_defecto: str = ""


@dataclass
class Modelo:
    nombre: str
    tabla: str
    esquema: str
    columnas: list[Columna] = field(default_factory=list)
    comentario: str = ""


def _tipo(base: str, attrs: str, enums: set[str]) -> str:
    if base in enums:
        return f"enum {base}"
    if "@db.Uuid" in attrs:
        return "uuid"
    if "@db.Date" in attrs:
        return "date"
    if re.search(r"@db\.Time(?!stamp)", attrs):
        return "time"
    m = re.search(r"@db\.Decimal\((\d+),\s*(\d+)\)", attrs)
    if m:
        return f"numeric({m.group(1)},{m.group(2)})"
    m = re.search(r"@db\.VarChar\((\d+)\)", attrs)
    if m:
        return f"varchar({m.group(1)})"
    return {"String": "text", "Int": "int", "BigInt": "bigint", "Decimal": "numeric", "Boolean": "bool",
            "DateTime": "timestamptz", "Json": "jsonb", "Float": "float", "Bytes": "bytea"}.get(base, base)


def _defecto(attrs: str) -> str:
    i = attrs.find("@default(")
    if i < 0:
        return ""
    prof, ini = 0, i + len("@default(")
    for j in range(ini - 1, len(attrs)):
        if attrs[j] == "(":
            prof += 1
        elif attrs[j] == ")":
            prof -= 1
            if prof == 0:
                return attrs[ini:j]
    return attrs[ini:]


def leer(ruta: Path) -> tuple[list[Modelo], dict[str, list[str]]]:
    texto = ruta.read_text(encoding="utf-8")
    enums = {m.group(1): re.findall(r"^\s+(\w+)\s*(?:@map.*)?$", m.group(2), re.M)
             for m in re.finditer(r"^enum (\w+) \{(.*?)^\}", texto, re.M | re.S)}
    nombres = {m.group(1) for m in re.finditer(r"^model (\w+) \{", texto, re.M)}
    modelos = []
    for m in re.finditer(r"((?:^//[^\n]*\n)*)^model (\w+) \{(.*?)^\}", texto, re.M | re.S):
        previo, nombre, cuerpo = m.groups()
        coment = " ".join(l.lstrip("/ ").strip() for l in previo.splitlines()).strip()
        tabla = re.search(r'@@map\("([^"]+)"\)', cuerpo)
        esq = re.search(r'@@schema\("([^"]+)"\)', cuerpo)
        mod = Modelo(nombre, tabla.group(1) if tabla else nombre, esq.group(1) if esq else "", comentario=coment)
        pendiente = []
        for linea in cuerpo.splitlines():
            s = linea.strip()
            if s.startswith("//"):
                pendiente.append(s.lstrip("/ ").strip())
                continue
            if not s or s.startswith("@@"):
                pendiente = []
                continue
            c = re.match(r"(\w+)\s+(\w+)(\[\]|\?)?\s*(.*?)(?:\s*//\s*(.*))?$", s)
            if not c:
                continue
            campo, base, mod_t, attrs, inline = c.groups()
            if mod_t == "[]" and base in nombres:
                pendiente = []
                continue  # lado inverso de una relación
            if base in nombres:  # campo de relación: la FK va en otro campo
                pendiente = []
                continue
            nombre_col = (re.search(r'@map\("([^"]+)"\)', attrs) or [None, campo])[1]
            col = Columna(nombre_col, campo, _tipo(base, attrs, set(enums)) + ("[]" if mod_t == "[]" else ""), mod_t != "?",
                          pk="@id" in attrs, unica="@unique" in attrs)
            col.por_defecto = _defecto(attrs)
            col.comentario = (" ".join(pendiente) + " " + (inline or "")).strip()
            pendiente = []
            mod.columnas.append(col)
        # FKs: campos de relación con fields: [x]
        for r in re.finditer(r"^\s*\w+\s+(\w+)\??\s+@relation\((?:[^)]*?)fields:\s*\[(\w+)\]", cuerpo, re.M):
            destino, fk = r.groups()
            for col in mod.columnas:
                if col.campo == fk:
                    col.fk = destino
        modelos.append(mod)
    return modelos, enums


def por_nombre(modelos: list[Modelo]) -> dict[str, Modelo]:
    return {m.nombre: m for m in modelos}
