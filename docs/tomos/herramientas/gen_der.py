#!/usr/bin/env python3
"""Genera en Markdown el documento del modelo de datos: DER por servicio y diccionario de datos."""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "diagramas"))
import prisma_modelo as pm  # noqa: E402
from der_puml import GRUPOS, REPO  # noqa: E402

NOMBRES = {"users": "Identidad (esquema `users`)", "shipments": "Envíos, viajes y soporte (esquema `shipments`)",
           "payments": "Pagos (esquema `payments`)", "admin": "Administración (esquema `admin`)"}
SERVICIOS = {"users": "movo-svc-users", "shipments": "movo-svc-shipments", "payments": "movo-svc-payments", "admin": "movo-svc-admin"}


def esc(s: str) -> str:
    return s.replace("|", "\\|").replace("\n", " ").strip()


def primera_frase(s: str, n: int = 190) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"^(MOVO-\d+[^:]*:\s*)", "", s)
    corte = re.search(r"(?<=[a-záéíóúñ\)])\.\s", s)
    s = s[: corte.start() + 1] if corte else s
    return s if len(s) <= n else s[: n - 1].rsplit(" ", 1)[0] + "…"


def main() -> None:
    out = ["# Modelo de Datos y Diccionario\n"]
    out.append(
        "El modelo de datos relacional vive en una única instancia de PostgreSQL 16 con **un esquema por microservicio** (ADR-003). "
        "Cada servicio define su esquema con Prisma (ADR-011) y es el único que lo lee y escribe: las referencias entre esquemas "
        "(por ejemplo, el emisor de un envío o el pagador de un hold) son **referencias lógicas por identificador, sin clave foránea real**, "
        "de modo que ningún servicio depende de las tablas de otro. Los diagramas y el diccionario de este documento se generan "
        "directamente de los archivos `schema.prisma`, por lo que reflejan el estado real del código.\n"
    )
    out.append(
        "En los diagramas, `*` marca una columna obligatoria, `PK` la clave primaria y `FK` una clave foránea. "
        "Por legibilidad cada entidad muestra su clave, sus claves foráneas y las columnas más relevantes; el detalle completo de cada tabla "
        "está en el diccionario de datos de cada sección. Las entidades de otro grupo que se referencian por clave foránea aparecen solo con su clave.\n"
    )
    tot_t = tot_c = 0
    for servicio, grupos in GRUPOS.items():
        modelos, enums = pm.leer(REPO / "services" / SERVICIOS[servicio] / "prisma" / "schema.prisma")
        mapa = pm.por_nombre(modelos)
        tot_t += len(modelos); tot_c += sum(len(m.columnas) for m in modelos)
        out.append(f"## {NOMBRES[servicio]}\n")
        out.append(f"El esquema contiene {len(modelos)} tablas y {len(enums)} tipos enumerados.\n")
        for ident, titulo, _ in grupos:
            out.append(f"![DER: {titulo}.](diagrama:{ident}){{.borde .sin-corte}}\n")
        out.append("### Tablas\n")
        out.append("| Tabla | Propósito | Columnas |\n|----------------|--------------------------------------------------------------|---------:|")
        for m in modelos:
            out.append(f"| `{m.tabla}` | {esc(primera_frase(m.comentario)) or '–'} | {len(m.columnas)} |")
        out.append(f"\n: Tablas del esquema `{servicio}`.\n")
        out.append("### Tipos enumerados\n")
        out.append("| Tipo | Valores |\n|--------------------|----------------------------------------------------------------|")
        for nombre, vals in enums.items():
            out.append(f"| `{nombre}` | {', '.join(f'`{v}`' for v in vals)} |")
        out.append(f"\n: Enumerados del esquema `{servicio}`.\n")
        out.append("### Diccionario de datos\n")
        for m in modelos:
            out.append(f"#### `{m.tabla}`\n")
            out.append("| Columna | Tipo | Restricciones | Descripción |\n|------------------|------------------|----------------|-----------------------------------------------|")
            for c in m.columnas:
                r = []
                if c.pk:
                    r.append("PK")
                if c.fk:
                    r.append(f"FK → `{mapa[c.fk].tabla}`")
                if c.unica:
                    r.append("único")
                r.append("no nulo" if c.obligatoria else "nulo")
                if c.por_defecto and c.por_defecto not in ("dbgenerated(\"gen_random_uuid()\")",):
                    r.append(f"por defecto {c.por_defecto}")
                out.append(f"| `{c.nombre}` | {c.tipo} | {esc(', '.join(r))} | {esc(primera_frase(c.comentario, 150))} |")
            out.append(f"\n: Columnas de `{m.tabla}`.\n")
    out.insert(2, f"En total el modelo comprende **{tot_t} tablas** y **{tot_c} columnas** en cuatro esquemas.\n")
    print("\n".join(out))


if __name__ == "__main__":
    main()
