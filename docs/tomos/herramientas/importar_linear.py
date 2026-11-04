#!/usr/bin/env python3
"""Actualiza datos/historias.json a partir de un export CSV de Linear.

Uso: python3 herramientas/importar_linear.py export.csv

Se actualizan estado, ciclo, estimación, responsable, título y sub-issues de cada ticket. Los criterios de
aceptación ya cargados se conservan (se redactaron y revisaron a mano); solo se extraen del texto del ticket
cuando el ticket es nuevo. Un ticket que ya no aparece en el export se deja como estaba.
"""
import csv
import json
import re
import sys
from pathlib import Path

DESTINO = Path(__file__).resolve().parent.parent / "datos" / "historias.json"
RESPONSABLES = {
    "juancruzbordino@gmail.com": "J.C. Bordino B.", "arizaalena@gmail.com": "A. Ariza",
    "tivergara@outlook.com": "T. Vergara", "pedro.yorlano@gmail.com": "P. Yorlano",
    "lucasdalmagro1@gmail.com": "L. Dalmagro",
}


def numero(i: str) -> int:
    return int(i.split("-")[1])


def criterios(desc: str) -> list[str]:
    m = re.search(r"Criterios de aceptaci[oó]n:?\s*\n(.*?)(?:\n---|\n## |\Z)", desc, re.S)
    if not m:
        return []
    return [re.sub(r"^\s*[*-]\s+", "", l).strip() for l in m.group(1).splitlines() if re.match(r"^\s*[*-]\s+", l)]


def ficha(x: dict) -> dict:
    ciclo = x["Cycle Name"] or (f"Cycle {x['Cycle Number']}" if x["Cycle Number"] else "")
    sp = str(int(float(x["Estimate"]))) if x["Estimate"] else ""
    return {"id": x["ID"], "titulo": x["Title"], "estado": x["Status"], "ciclo": ciclo, "sp": sp,
            "asignado": RESPONSABLES.get(x["Assignee"], x["Assignee"])}


def main() -> None:
    filas = list(csv.DictReader(open(sys.argv[1], encoding="utf-8")))
    viejo = json.loads(DESTINO.read_text(encoding="utf-8"))
    por_id = {x["ID"]: x for x in filas}
    nuevo = {}
    for i in sorted(por_id, key=numero):
        x = por_id[i]
        f = ficha(x)
        f["ac"] = viejo[i]["ac"] if i in viejo else criterios(x["Description"])
        f["hijos"] = [ficha(c) for c in sorted((c for c in filas if c["Parent issue"] == i), key=lambda c: numero(c["ID"]))]
        f["padre"] = x["Parent issue"]
        nuevo[i] = f
    ausentes = [i for i in viejo if i not in nuevo]
    for i in ausentes:  # no figura en el export: se conserva su última versión conocida
        nuevo[i] = viejo[i]
    nuevo = dict(sorted(nuevo.items(), key=lambda kv: numero(kv[0])))
    cambios = [(i, viejo[i]["estado"], nuevo[i]["estado"]) for i in nuevo if i in viejo and viejo[i]["estado"] != nuevo[i]["estado"]]
    DESTINO.write_text(json.dumps(nuevo, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(nuevo)} tickets ({len(set(nuevo) - set(viejo))} nuevos, {len(ausentes)} ausentes del export: {ausentes})")
    for c in cambios:
        print("  estado", *c)


if __name__ == "__main__":
    main()
