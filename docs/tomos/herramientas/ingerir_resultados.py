#!/usr/bin/env python3
"""Consolida los resultados de ejecución de las suites en datos/resultados.json.

Cada suite se ejecutó con su reporter JSON (Vitest, Jest) o JUnit XML (Pytest). El resultado
por archivo de prueba es "passed" si todos sus casos pasaron o "failed" si alguno falló;
los casos omitidos (skipped, p. ej. las pruebas contra el sandbox de Mercado Pago) no cuentan
como fallas. También se guardan los totales por paquete para el Plan de Testing.

Uso: ingerir_resultados.py <paquete>=<ruta> ...   (la ruta es relativa al repositorio)
"""
import json
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
REPO = RAIZ.parent.parent
SALIDA = RAIZ / "datos" / "resultados.json"


def relativa(ruta: str) -> str:
    p = Path(ruta)
    try:
        return str(p.resolve().relative_to(REPO))
    except ValueError:
        return str(p)


def leer_json(ruta: Path) -> tuple[dict, dict]:
    d = json.loads(ruta.read_text(encoding="utf-8"))
    por_archivo, totales = {}, {"passed": 0, "failed": 0, "skipped": 0}
    for f in d["testResults"]:
        casos = f.get("assertionResults", [])
        estados = [c["status"] for c in casos]
        for e in estados:
            totales["passed" if e == "passed" else "failed" if e == "failed" else "skipped"] += 1
        if f.get("status") == "failed" and "failed" not in estados:
            totales["failed"] += 1
            por_archivo[relativa(f["name"])] = "failed"
        elif "failed" in estados:
            por_archivo[relativa(f["name"])] = "failed"
        elif "passed" in estados:
            por_archivo[relativa(f["name"])] = "passed"
        else:
            por_archivo[relativa(f["name"])] = "skipped"
    return por_archivo, totales


def leer_junit(ruta: Path, base: str) -> tuple[dict, dict]:
    por_archivo, totales = {}, {"passed": 0, "failed": 0, "skipped": 0}
    for caso in ET.parse(ruta).getroot().iter("testcase"):
        clase = caso.get("classname", "")
        modulo = clase if clase.rsplit(".", 1)[-1].startswith("test_") else clase.rsplit(".", 1)[0]
        archivo = base + "/" + modulo.replace(".", "/") + ".py"
        estado = "failed" if (caso.find("failure") is not None or caso.find("error") is not None) else "skipped" if caso.find("skipped") is not None else "passed"
        totales[estado] += 1
        previo = por_archivo.get(archivo)
        if estado == "failed" or previo is None or (previo == "skipped" and estado == "passed"):
            por_archivo[archivo] = estado
    return por_archivo, totales


def main(args: list[str]) -> None:
    res, tot = {}, {}
    for a in args:
        paquete, ruta = a.split("=", 1)
        r = Path(ruta)
        if r.suffix == ".xml":
            por, t = leer_junit(r, "services/movo-svc-pricing-logistics")
        else:
            por, t = leer_json(r)
        res.update(por)
        tot[paquete] = t
    SALIDA.write_text(json.dumps({"archivos": res, "totales": tot}, ensure_ascii=False, indent=1), encoding="utf-8")
    for k, v in tot.items():
        print(f"{k:28s} {v['passed']:5d} pasan  {v['failed']:3d} fallan  {v['skipped']:3d} omitidos")


if __name__ == "__main__":
    main(sys.argv[1:])
