#!/usr/bin/env python3
"""Genera capturas/LISTA-DE-CAPTURAS.md: qué capturas hay que tomar (nuevas) o rehacer (actualizar / verificar).

Sale de datos/capturas.yaml: cada entrada con `accion` (nueva | actualizar | verificar) entra en la lista.
Uso: python3 herramientas/gen_lista_capturas.py
"""
from pathlib import Path

import yaml

RAIZ = Path(__file__).resolve().parent.parent
CAPS = yaml.safe_load((RAIZ / "datos" / "capturas.yaml").read_text(encoding="utf-8"))["capturas"]

PREP = [
    ("M-94, M-95, M-102", "Un emisor **sin deuda** para elegir «Efectivo» (M-94), y otro con un **saldo pendiente** con Movo para ver la opción bloqueada (M-95). M-102 se toma como transportista sobre un envío publicado en efectivo."),
    ("M-96, M-97, M-99", "Un envío **en efectivo** asignado (M-96), llevado hasta la **entrega** para ver el aviso del saldo (M-97), y otro asignado con **menos de 12 h** al retiro para cancelarlo con penalidad (M-99)."),
    ("M-98", "Un transportista con una **deuda mayor a 30.000 ARS** (se carga con un ajuste manual de la cuenta corriente desde el panel)."),
    ("M-100", "Una **cuenta nueva** (o borrar el registro del tutorial) para que aparezca el pop-up «Publicá un envío» sobre Inicio."),
    ("M-101", "Dos consultas de soporte: una abierta con respuesta del equipo sin leer y una resuelta."),
    ("W-19 a W-22", "Al menos una disputa **abierta** y una **resuelta**. Para W-21, abrir una abierta con el botón «Resolver disputa» y elegir «parcial». W-22 requiere forzar un fallo de pago en dev; si no se logra, se omite."),
    ("W-23 a W-25", "Un envío **asignado** sin retirar, con un administrador que **no sea parte**. El paso 3 envía un código de 6 dígitos al correo del administrador: tomar la captura antes de confirmar para no cambiar el estado."),
    ("W-26", "Un usuario con una **suspensión vigente** (aplicarla desde W-16 primero)."),
    ("W-27 a W-33", "Rango de **30 días** con envíos completados, cobros y disputas. Si la red de dev tiene pocos datos, usar el selector **Datos: Demo** (queda el aviso amarillo, aceptable para el manual) o avisar para decidirlo."),
    ("W-34, W-35", "Bitácora con acciones de varios administradores (las de las capturas anteriores alcanzan)."),
]


def fila(c: dict) -> str:
    return f"| `{c['id']}` | {c['titulo']} | `{c['pantalla']}` | {c['estado']} |" + (f" {c['motivo']} |" if "motivo" in c else "")


def tabla(cs: list[dict], con_motivo: bool) -> str:
    cab = "| Archivo | Qué es | Pantalla | Estado a dejar |" + (" Por qué |" if con_motivo else "")
    sep = "|---|---|---|---|" + ("---|" if con_motivo else "")
    return "\n".join([cab, sep] + [fila(c) for c in cs]) + "\n"


def main() -> None:
    por = lambda acc, pl: [c for c in CAPS if c.get("accion") == acc and c["plataforma"] == pl]
    nm, nw = por("nueva", "movil"), por("nueva", "web")
    am, aw = por("actualizar", "movil"), por("actualizar", "web")
    vm, vw = por("verificar", "movil"), por("verificar", "web")
    n = sum(len(x) for x in (nm, nw, am, aw, vm, vw))
    o = ["# Lista de capturas pendientes del Manual de Usuario\n",
         f"Generada desde `datos/capturas.yaml`. Son **{len(nm)+len(nw)} nuevas**, **{len(am)+len(aw)} para actualizar** y **{len(vm)+len(vw)} para verificar** ({n} en total). "
         "Las demás capturas del manual no cambian.\n",
         "- **Nueva**: la pantalla o el estado no estaba en el manual. El texto y el lugar ya están en `manual.md`, y hasta que exista el archivo el PDF muestra un marco «Captura pendiente».",
         "- **Actualizar**: la pantalla cambió en el Sprint 8; hay que volver a tomarla.",
         "- **Verificar**: la pantalla puede haber cambiado según el estado; compararla con la actual y rehacerla solo si se ve distinta.\n",
         "## Formato y nombres\n",
         "- **Móvil:** simulador de iPhone 16 Pro, tema claro, barra de estado 9:41 (`capturas/preparar-simulador.sh`). PNG de 1206 x 2622 px en `assets/capturas/M-NN.png`; después `python3 capturas/enmarcar_todas.py M-94 M-95 ...` genera la versión con marco.",
         "- **Panel:** Chrome a 1512 px de ancho, tema claro, sesión de administrador en dev. PNG de la página completa en `assets/capturas/W-NN.png`; el build recorta el blanco sobrante al pie.",
         "- Reglas generales, cuentas de prueba y flujos de Maestro: `capturas/README.md` y `capturas/flujos/`.",
         "- Revisar que no se vean datos reales de personas (nombre, teléfono, dirección).\n",
         "## Datos de prueba que hay que preparar\n",
         "| Capturas | Qué dejar armado |", "|---|---|"]
    o += [f"| {a} | {b} |" for a, b in PREP]
    o.append("")
    o.append(f"## Nuevas, aplicación móvil ({len(nm)})\n")
    o.append(tabla(nm, False))
    o.append(f"## Nuevas, panel de administración ({len(nw)})\n")
    o.append(tabla(nw, False))
    o.append(f"## Para actualizar, aplicación móvil ({len(am)})\n")
    o.append(tabla(am, True))
    o.append(f"## Para actualizar, panel de administración ({len(aw)})\n")
    o.append("Casi todas se actualizan por la **barra lateral nueva** (suma **Disputas** y el grupo **Reportería**). Conviene tomarlas en la misma sesión, con la sesión ya iniciada y el tema claro.\n")
    o.append(tabla(aw, True))
    o.append(f"## Para verificar, aplicación móvil ({len(vm)})\n")
    o.append(tabla(vm, True))
    if vw:
        o.append(f"## Para verificar, panel de administración ({len(vw)})\n")
        o.append(tabla(vw, True))
    o.append("## Sin cambios\n")
    o.append("`W-01`, `W-02` y `W-03` (ingreso, verificación y recuperación) y el resto de las capturas móviles no se tocan.\n")
    (RAIZ / "capturas" / "LISTA-DE-CAPTURAS.md").write_text("\n".join(o), encoding="utf-8")
    print(f"{n} capturas en la lista")


if __name__ == "__main__":
    main()
