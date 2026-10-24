#!/usr/bin/env python3
"""Genera en Markdown la trazabilidad de las historias de usuario de un tema (épica).

Uso: gen_tema.py <ep-id>   (por ejemplo, ep01)

Combina tres fuentes:
  - datos/historias.json   historias, criterios de aceptación y sub-issues (export de Linear);
  - datos/hu-<ep>.yaml     descripción curada, secuencias y casos de prueba de cada historia;
  - datos/resultados.json  resultados de la última ejecución de las suites (archivo -> estado).
"""
import json
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seccionar  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
DATOS = RAIZ / "datos"
ESTADOS = {"Done": ("Completada", "ok"), "In Progress": ("En curso", "warn"), "In Review": ("En revisión", "warn"),
           "Todo": ("Por hacer", ""), "Backlog": ("Backlog", ""), "Canceled": ("Cancelada", "err")}
CICLO_SPRINT = {f"Cycle {n}": f"Sprint {n - 1}" for n in range(2, 12)}


def esc(s: str) -> str:
    return s.replace("|", "\\|").replace("\n", " ").strip()


def chip(txt: str, clase: str = "") -> str:
    return f'<span class="chip {clase}">{txt}</span>'


def sprints_de(h: dict) -> str:
    ciclos = []
    if h.get("ciclo"):
        ciclos.append(h["ciclo"])
    for k in h.get("hijos", []):
        if k.get("ciclo"):
            ciclos.append(k["ciclo"])
    sp = sorted({CICLO_SPRINT.get(c, c) for c in ciclos}, key=lambda s: int(s.split()[-1]) if s.split()[-1].isdigit() else 99)
    return ", ".join(sp) if sp else "sin asignar"


def resultado(archivos: list[str], res: dict) -> str:
    estados = [res.get(a) for a in archivos]
    if not archivos:
        return "Manual"
    if all(e == "passed" for e in estados):
        return "Aprobado"
    if any(e == "failed" for e in estados):
        return "Falla"
    if all(e is None for e in estados):
        return "Sin ejecutar"
    if all(e in ("passed", "skipped") for e in estados) and all(e == "skipped" for e in estados):
        return "Omitido"
    return "Aprobado"


def main(ep: str) -> None:
    H = json.loads((DATOS / "historias.json").read_text(encoding="utf-8"))
    res = {}
    if (DATOS / "resultados.json").exists():
        res = json.loads((DATOS / "resultados.json").read_text(encoding="utf-8")).get("archivos", {})
    cfg = yaml.safe_load((DATOS / f"hu-{ep}.yaml").read_text(encoding="utf-8"))
    out = ["# Historias de Usuario y Trazabilidad\n"]
    out.append(cfg.get("presentacion", "").strip() + "\n")
    out.append("| Historia | Descripción | Estado | Sprint |\n|----------|--------------------------------------------------|------------|--------------------|")
    for hu in cfg["historias"]:
        h = H[hu["id"]]
        est, _ = ESTADOS.get(h["estado"], (h["estado"], ""))
        out.append(f"| `{hu['id']}` | {esc(hu['nombre'])} | {est} | {sprints_de(h)} |")
    out.append("\n: Historias de usuario del tema.\n")
    for hu in cfg["historias"]:
        h = H[hu["id"]]
        num = hu["id"].split("-")[1]
        est, clase = ESTADOS.get(h["estado"], (h["estado"], ""))
        sp = sum(float(k["sp"] or 0) for k in h["hijos"]) or float(h["sp"] or 0)
        out.append(f"## {hu['id']} · {hu['nombre']}\n")
        out.append(f'<div class="hu"><div class="hu-cab"><span class="id">{hu["id"]}</span><span>'
                   f'{chip(est, "lime" if clase == "ok" else "")}{chip(sprints_de(h))}'
                   f'{chip(f"{sp:.0f} SP") if sp else ""}</span></div>'
                   f'<div class="hu-cuerpo"><p class="hu-enunciado">{esc(hu.get("enunciado") or h["titulo"])}</p></div></div>\n')
        if hu.get("nota"):
            out.append(f"::: nota\n{hu['nota'].strip()}\n:::\n")
        ac = hu.get("ac") or h["ac"]
        if ac:
            out.append("##### Criterios de aceptación\n")
            out.append("\n".join(f"{i + 1}. {a}" for i, a in enumerate(ac)) + "\n")
        hijos = [k for k in h["hijos"]]
        if hijos:
            out.append("##### Trazabilidad de implementación\n")
            out.append("| Ticket | Alcance | Sprint | Estado |\n|----------|--------------------------------------------------------|------------|------------|")
            for k in hijos:
                e2, _ = ESTADOS.get(k["estado"], (k["estado"], ""))
                out.append(f"| `{k['id']}` | {esc(k['titulo'])} | {CICLO_SPRINT.get(k['ciclo'], k['ciclo'] or '–')} | {e2} |")
            out.append(f"\n: Tickets de implementación de {hu['id']}.\n")
        for s in hu.get("secuencias", []):
            out.append("##### Diagrama de secuencia\n")
            fuente = (RAIZ / "diagramas" / f"{s['id']}.puml").read_text(encoding="utf-8")
            trozos = seccionar.partes(fuente, s["id"])
            if not trozos:
                out.append(f"![{s['titulo']}](diagrama:{s['id']}){{.sin-corte}}\n")
            for n, (sec, _) in enumerate(trozos, 1):
                base = s["titulo"].rstrip(".")
                out.append(f"![{base}. Parte {n} de {len(trozos)}: {sec}.](diagrama:{s['id']}-{n}){{.sin-corte}}\n")
        casos = hu.get("casos", [])
        if casos:
            out.append("##### Casos de prueba\n")
            out.append('<table class="caso compacta"><caption>Casos de prueba de ' + hu["id"] + ' (derivados del código y de los criterios de aceptación).</caption>'
                       '<colgroup><col style="width:8%"><col style="width:5%"><col style="width:35%"><col style="width:25%"><col style="width:14%"><col style="width:13%"></colgroup>'
                       '<thead><tr><th>ID</th><th>AC</th><th>Caso, precondición y pasos</th><th>Resultado esperado</th><th>Verificación automatizada</th><th>Resultado</th></tr></thead><tbody>')
            for i, c in enumerate(casos, 1):
                tests = c.get("test", [])
                if isinstance(tests, str):
                    tests = [tests]
                nombres = "<br>".join(f"<code>{Path(t).name}</code>" for t in tests) or "–"
                r = c.get("resultado") or resultado(tests, res)
                cl = "ok" if r == "Aprobado" else ("err" if r == "Falla" else ("warn" if r == "Pendiente" else ""))
                out.append(f'<tr><td class="mono">CP-{num}.{i:02d}</td><td>{esc(str(c.get("ac", "–")))}</td>'
                           f'<td><b>{esc(c["titulo"])}</b><br><em>Pre:</em> {esc(c["pre"])}<br><em>Pasos:</em> {esc(c["pasos"])}</td>'
                           f'<td>{esc(c["esperado"])}</td><td>{nombres}</td><td><span class="chip {cl}">{r}</span></td></tr>')
            out.append("</tbody></table>\n")
    print("\n".join(out))


if __name__ == "__main__":
    main(sys.argv[1])
