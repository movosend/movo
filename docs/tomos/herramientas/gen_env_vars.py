#!/usr/bin/env python3
"""Imprime las variables de entorno de cada servicio a partir de sus archivos .env.example."""
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
SERVICIOS = [
    ("Infraestructura (Docker Compose)", "infra/.env.example"),
    ("API Gateway", "gateway/.env.example"),
    ("movo-svc-users", "services/movo-svc-users/.env.example"),
    ("movo-svc-shipments", "services/movo-svc-shipments/.env.example"),
    ("movo-svc-payments", "services/movo-svc-payments/.env.example"),
    ("movo-svc-admin", "services/movo-svc-admin/.env.example"),
    ("movo-svc-pricing-logistics", "services/movo-svc-pricing-logistics/.env.example"),
    ("Panel de administración (movo-admin)", "movo-admin/.env.example"),
]
SECRETOS = re.compile(r"(SECRET|PASSWORD|TOKEN|API_KEY|KEY_SID|PRIVATE|_PAT)", re.I)


def limpiar(coment: list[str]) -> str:
    t = " ".join(c.lstrip("# ").strip() for c in coment)
    t = re.sub(r"\((?:[^()]*?(?:MOVO-\d+|ADR-\d+)[^()]*?)\)", "", t)
    t = re.sub(r"\bMOVO-\d+(?:/MOVO-\d+)*:?\s*", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    m = re.search(r"(?<=[a-záéíóúñ\)])\.\s", t)
    t = t[: m.start() + 1] if m else t
    t = re.sub(r"^[:\s.,;-]+", "", t)
    if t.startswith(("Env para", "En dev/prod")) or len(t) < 14:
        return ""
    t = t[0].upper() + t[1:] if t else t
    return (t[:210].rsplit(" ", 1)[0] + "…") if len(t) > 210 else t


def main() -> None:
    out = []
    for nombre, ruta in SERVICIOS:
        p = REPO / ruta
        if not p.exists():
            continue
        filas, coment = [], []
        for linea in p.read_text(encoding="utf-8").splitlines():
            if linea.startswith("#"):
                coment.append(linea)
                continue
            m = re.match(r"([A-Z][A-Z0-9_]*)=(.*)", linea)
            if m:
                var, valor = m.groups()
                muestra = "(secreto)" if SECRETOS.search(var) and valor else (valor if valor else "(vacío)")
                if len(muestra) > 38:
                    muestra = muestra[:35] + "…"
                filas.append((var, limpiar(coment) or "–", muestra))
                coment = []
            elif not linea.strip():
                coment = [] if not coment or len(coment) > 12 else coment
        if not filas:
            continue
        out.append(f"## {nombre}\n")
        out.append("| Variable | Descripción | Valor de ejemplo |\n|--------------------|------------------------------------------------------|----------------|")
        for v, d, m in filas:
            out.append(f"| `{v}` | {d.replace('|', '/')} | `{m}` |")
        out.append(f"\n: Variables de entorno de {nombre}.\n")
    print("\n".join(out))


if __name__ == "__main__":
    main()
