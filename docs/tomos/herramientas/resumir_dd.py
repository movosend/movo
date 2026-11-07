#!/usr/bin/env python3
"""Actualiza la síntesis del Tomo II desde el registro íntegro de DD."""
import html
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
FUENTE = RAIZ / "anexos" / "decisiones-diseno-completas.md"
DESTINO = RAIZ / "contenido" / "tomo-2" / "13b-decisiones-de-diseno" / "decisiones.md"
COMPLETAS_EN_TOMO = {"DD-037", "DD-050", "DD-056"}


def limpiar(texto: str) -> str:
    texto = re.sub(r"<[^>]+>", " ", texto)
    texto = html.unescape(texto)
    for a, b in ((r"\_", "_"), (r"\+", "+"), (r"\*", "*"), (r"\.", ".")):
        texto = texto.replace(a, b)
    texto = re.sub(r"\*\*|`", "", texto)
    texto = re.sub(r"\s+", " ", texto).strip()
    return re.sub(r"^\d+\.\s*", "", texto)


def primera_frase(texto: str) -> str:
    texto = limpiar(texto)
    fin = re.search(r"(?<=[a-záéíóúñ)0-9])\.\s+(?=[A-ZÁÉÍÓÚ])", texto)
    return texto[: fin.start() + 1] if fin else texto


def primer_parrafo(texto: str) -> str:
    return re.split(r"\n\s*\n", texto.strip())[0]


def generar() -> int:
    bloques = re.split(r"(?=^## DD-\d+)", FUENTE.read_text(encoding="utf-8"), flags=re.M)[1:]
    salida = [
        "# Registro resumido de decisiones de diseño", "",
        "Las decisiones de alcance local se resumen aquí para ubicar la regla y su efecto. "
        "El registro íntegro, con contexto, alternativas y referencias, se conserva en el "
        "anexo digital `docs/tomos/anexos/decisiones-diseno-completas.md`. Los ADR de "
        "arquitectura permanecen completos en Arquitectura del Sistema. Las DD-037, DD-050 "
        "y DD-056 se reproducen completas porque explican la asignación, la vigencia del pago "
        "y la resolución de disputas.", "",
    ]
    for bloque in bloques:
        titulo = bloque.splitlines()[0]
        if titulo.split()[1] in COMPLETAS_EN_TOMO:
            salida += [bloque.strip(), ""]
            continue
        partes = re.split(r'<span class="dd-etq">([^<]+)</span>', bloque)
        secciones = {partes[i].strip(): partes[i + 1] for i in range(1, len(partes) - 1, 2)}
        decision = secciones.get("Decisión", "")
        rotulo = re.search(r"\*\*Decisión tomada:\*\*\s*(.*)", decision, re.S)
        decision = rotulo.group(1) if rotulo else decision
        decision = re.sub(r"^Complementa [^.]+\.\s*", "", decision.strip())
        efecto = primer_parrafo(secciones.get("Consecuencias", ""))
        salida += [
            titulo, "", f"**Decisión.** {primera_frase(primer_parrafo(decision))}", "",
            f"**Efecto o costo.** {primera_frase(efecto) if efecto else 'Ver el registro completo para las consecuencias y alternativas.'}", "",
        ]
    DESTINO.write_text("\n".join(salida), encoding="utf-8")
    return len(bloques)


if __name__ == "__main__":
    print(f"{generar()} DD -> {DESTINO}")
