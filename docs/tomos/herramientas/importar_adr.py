#!/usr/bin/env python3
"""Importa los ADR del documento "[Movo] 004 - Sprint 0" (export HTML de Drive) a datos/adr.json.

Uso: python3 herramientas/importar_adr.py <sprint0.html>

Cada ADR es una tabla del documento: una fila de título y estado, filas de sección de una celda (CONTEXTO,
CRITERIOS, ALTERNATIVAS, DECISION, CONSECUENCIAS, REFERENCIAS) y filas de dos celdas (etiqueta, párrafos).
"""
import json
import re
import sys
from pathlib import Path

from bs4 import BeautifulSoup

SALIDA = Path(__file__).resolve().parents[1] / "datos" / "adr.json"
# Erratas del documento de origen que no conviene arrastrar al título.
FIX_TITULO = {"Handhsake": "Handshake", "Statelesness": "Statelessness"}
SECCIONES = {
    "CONTEXTO": "contexto",
    "CRITERIOS DE COMPARACIÓN": "criterios",
    "ALTERNATIVAS CONSIDERADAS": "alternativas",
    "DECISION": "decision",
    "DECISIÓN": "decision",
    "CONSECUENCIAS": "consecuencias",
    "REFERENCIAS": "referencias",
}


def parrafos(celda) -> list[str]:
    """Texto de cada párrafo de la celda; los <li> de una lista ordenada se numeran."""
    out = []
    for hijo in celda.find_all(["p", "li"]):
        txt = re.sub(r"\s+", " ", hijo.get_text(" ", strip=False)).strip()
        txt = re.sub(r"\s+([,.;:)])", r"\1", txt)
        txt = re.sub(r"\(\s+", "(", txt)
        if not txt:
            continue
        if hijo.name == "li":
            n = len([x for x in hijo.find_previous_siblings("li")]) + 1
            txt = f"{n}. {txt}"
        out.append(txt)
    # un <p> dentro de un <li> se contó dos veces
    vistos, res = set(), []
    for t in out:
        k = re.sub(r"^\d+\. ", "", t)
        if k in vistos and not re.match(r"^\d+\. ", t):
            continue
        vistos.add(k)
        res.append(t)
    return res


BORRADOR = re.compile(r"Redactado a partir del[^.;]*(?:\.[a-z]+)*[^.;]*;\s*pendiente de revisión del equipo\.\s*")


def limpiar_alcance(pars: list[str]) -> list[str]:
    """Quita las marcas de borrador del Alcance y las notas internas de numeración; descarta lo que quede vacío."""
    out = []
    for p in pars:
        p = BORRADOR.sub("", p).strip()
        if p and not p.startswith("Numeración: el ticket"):
            out.append(p)
    return out


def main(ruta: str) -> None:
    sopa = BeautifulSoup(Path(ruta).read_text(encoding="utf-8"), "lxml")
    adrs = []
    for tabla in sopa.find_all("table"):
        primera = tabla.get_text(" ", strip=True)
        m = re.match(r"ADR-(\d{3})\s+(.*?)\s+Estado:\s*(.*?)\s+CONTEXTO", primera)
        if not m:
            continue
        numero, titulo, estado = m.group(1), m.group(2), m.group(3)
        for mal, bien in FIX_TITULO.items():
            titulo = titulo.replace(mal, bien)
        estado = estado.replace("· redacción pendiente de revisión", "").strip(" ·")
        adr = {"id": f"ADR-{numero}", "numero": numero, "titulo": titulo, "estado": estado.strip(), "secciones": []}
        actual = None
        for tr in tabla.find_all("tr"):
            celdas = tr.find_all("td", recursive=False)
            if len(celdas) == 1:
                clave = celdas[0].get_text(" ", strip=True)
                if clave in SECCIONES:
                    actual = {"clave": SECCIONES[clave], "filas": []}
                    adr["secciones"].append(actual)
                elif actual is not None and clave and not clave.startswith("ADR-"):
                    actual["filas"].append({"etiqueta": clave.title(), "parrafos": []})
            elif len(celdas) == 2 and actual is not None:
                etiqueta = celdas[0].get_text(" ", strip=True)
                pars = parrafos(celdas[1])
                if etiqueta == "Alcance":
                    pars = limpiar_alcance(pars)
                    if not pars:
                        continue
                actual["filas"].append({"etiqueta": etiqueta, "parrafos": pars})
        adrs.append(adr)
    SALIDA.write_text(json.dumps(adrs, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(adrs)} ADR -> {SALIDA}")


if __name__ == "__main__":
    main(sys.argv[1])
