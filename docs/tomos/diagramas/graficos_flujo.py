#!/usr/bin/env python3
"""Modelo de ramas y pipeline de CI/CD (Gestión de la Configuración, Tomo I; reutilizados en Tomos II y III).

Reflejan `.github/workflows/` (pr-checks, ci-dev, ci-prod, mobile-eas, sync-main-to-develop,
auto-assign-reviewers) y las reglas de ramas del Working Agreement. Si cambia un workflow, cambiar acá.
"""
from svg_comun import (BLANCO, INK, INK05, INK1, INK2, INK4, INK6, LIME, LIME_SUAVE, camino, circulo,
                       flecha_defs, guardar, linea, rect, t)

# ───────────────────────── Modelo de ramas ─────────────────────────


def ramas() -> None:
    W, H = 760, 390
    xl, xr = 168, 740
    Y = {"main": 64, "hotfix": 126, "develop": 206, "feature": 278, "fix": 336}
    etiquetas = [
        ("main", "main", "producción"),
        ("hotfix", "hotfix/MOVO-211-…", "desde main"),
        ("develop", "develop", "desarrollo (staging)"),
        ("feature", "feature/MOVO-142-…", "desde develop"),
        ("fix", "fix/MOVO-203-…", "desde develop"),
    ]
    s = []
    # Fondos de carril y nombres
    for k, nombre, sub in etiquetas:
        y = Y[k]
        permanente = k in ("main", "develop")
        s.append(rect(10, y - 21, W - 20, 42, INK05 if permanente else BLANCO, INK2 if permanente else BLANCO, 0.6, 6))
        s.append(t(22, y - 2, nombre, 9.4, 700, anchor="start", mono=True))
        s.append(t(22, y + 11, sub, 8, color=INK6, anchor="start"))
    # Líneas permanentes
    s.append(linea(xl, Y["main"], xr, Y["main"], INK, 3))
    s.append(linea(xl, Y["develop"], xr, Y["develop"], INK, 3))

    def commit(x, y, fill=BLANCO, r=6):
        s.append(circulo(x, y, r, fill, INK, 1.6))

    def rama(xa, ya, xb, yb, dash=""):
        """Curva entre carriles: sale de (xa, ya) y llega a (xb, yb)."""
        xm = (xa + xb) / 2
        s.append(camino(f"M{xa},{ya} C{xm},{ya} {xm},{yb} {xb},{yb}", INK, 1.6, dash, None))

    def merge(xa, ya, xb, yb, dash=""):
        xm = (xa + xb) / 2
        s.append(camino(f"M{xa},{ya} C{xm},{ya} {xm},{yb} {xb - 7},{yb}", INK, 1.6, dash, "fl"))

    def chip(x, y, texto, fill=BLANCO, borde=INK, ancho=None, color=INK):
        w = ancho or (len(texto) * 5.6 + 14)
        s.append(rect(x - w / 2, y - 8, w, 16, fill, borde, 0.9, 8))
        s.append(t(x, y + 3.2, texto, 7.8, 600, color))

    # feature: rama desde develop, tres commits, PR con squash
    yf, yd, ym, yh, yx = Y["feature"], Y["develop"], Y["main"], Y["hotfix"], Y["fix"]
    commit(196, yd)
    rama(196, yd, 236, yf)
    s.append(linea(236, yf, 330, yf, INK, 1.6))
    for x in (240, 276, 312):
        commit(x, yf, BLANCO, 4.5)
    merge(312, yf, 362, yd)
    commit(362, yd, LIME, 7)
    chip(276, yf + 24, "PR · pr-checks · 1 revisión", LIME_SUAVE)
    chip(362, yd - 24, "squash")
    chip(440, yd - 44, "cada merge a develop: ci-dev → deploy a dev", INK1)
    # fix: sale de develop después de integrar la feature, dos commits, PR con squash
    commit(392, yd)
    rama(392, yd, 426, yx)
    s.append(linea(426, yx, 466, yx, INK, 1.6))
    for x in (424, 452):
        commit(x, yx, BLANCO, 4.5)
    merge(452, yx, 486, yd)
    commit(486, yd, LIME, 7)
    # tag de la app móvil sobre develop
    commit(514, yd)
    s.append(f'<polygon points="514,{yd + 6} 534,{yd + 6} 540,{yd + 12} 534,{yd + 18} 514,{yd + 18}" '
             f'fill="{BLANCO}" stroke="{INK}" stroke-width="0.9"/>')
    s.append(t(520, yd + 32, "tag dev-* / v*", 7.8, 600, INK6, "start"))
    s.append(t(520, yd + 43, "→ mobile-eas", 7.8, 600, INK6, "start"))
    # release: PR de develop a main
    merge(540, yd, 580, ym)
    commit(580, ym, LIME, 7)
    chip(556, ym - 28, "PR develop → main · ci-prod", INK1)
    # hotfix: desde main, vuelve a main y la sincronización lo baja a develop
    rama(606, ym, 636, yh)
    s.append(linea(636, yh, 656, yh, INK, 1.6))
    commit(648, yh, BLANCO, 4.5)
    merge(648, yh, 684, ym)
    commit(684, ym, LIME, 7)
    merge(688, ym, 724, yd, "4 3")
    commit(724, yd, BLANCO)
    s.append(t(698, yh + 46, "sync-main-", 7.8, 600, INK6, "end"))
    s.append(t(698, yh + 56, "to-develop", 7.8, 600, INK6, "end"))
    commit(184, ym)
    # Leyenda
    ly = H - 16
    items = [(LIME, "merge por Pull Request (dispara un despliegue)"), (BLANCO, "commit"),
             (None, "sincronización automática")]
    lx = 20
    for fill, lab in items:
        if fill is None:
            s.append(linea(lx, ly - 3, lx + 22, ly - 3, INK, 1.4, "4 3"))
            s.append(t(lx + 30, ly, lab, 8.2, color=INK6, anchor="start"))
            lx += 190
        else:
            s.append(circulo(lx + 5, ly - 3, 5, fill, INK, 1.3))
            s.append(t(lx + 16, ly, lab, 8.2, color=INK6, anchor="start"))
            lx += 16 + len(lab) * 5.2 + 26
    guardar("gc-ramas", W, H, s, flecha_defs(INK))


# ───────────────────────── Pipeline de CI/CD ─────────────────────────


def pipeline() -> None:
    W = 760
    s = []

    def caja(x, y, w, h, titulo, lineas, fill=BLANCO, borde=INK, mono_titulo=True):
        s.append(rect(x, y, w, h, fill, borde, 1, 5))
        s.append(t(x + 8, y + 14, titulo, 8.6, 700, anchor="start", mono=mono_titulo))
        for i, l in enumerate(lineas):
            s.append(t(x + 8, y + 27 + i * 11, l, 7.8, color=INK6, anchor="start"))

    def disparador(y, h, titulo, sub, workflow):
        s.append(rect(14, y, 128, h, INK, INK, 1, 6))
        s.append(t(78, y + h / 2 - 8, titulo, 9.2, 700, BLANCO))
        s.append(t(78, y + h / 2 + 5, sub, 8, 400, INK2))
        s.append(t(78, y + h / 2 + 20, workflow, 7.6, 600, LIME, mono=True))

    def carril(y, h, etiqueta):
        s.append(rect(8, y - 8, W - 16, h + 16, INK05, INK2, 0.6, 8))

    def fl(x1, y1, x2, y2, dash=""):
        s.append(camino(f"M{x1},{y1} L{x2 - 2},{y2}", INK, 1.1, dash, "fl"))

    def fan(xa, ya, xb, ys):
        for yy in ys:
            xm = (xa + xb) / 2
            s.append(camino(f"M{xa},{ya} C{xm},{ya} {xm},{yy} {xb - 2},{yy}", INK, 1, "", "fl"))

    def fan_in(xa, ys, xb, yb):
        for yy in ys:
            xm = (xa + xb) / 2
            s.append(camino(f"M{xa},{yy} C{xm},{yy} {xm},{yb} {xb - 2},{yb}", INK, 1, "", "fl"))

    # ── Carril 1: Pull Request ──
    y = 22
    h = 196
    carril(y, h, "PR")
    disparador(y, h, "Pull Request", "hacia develop o main", "pr-checks.yml")
    caja(160, y + h / 2 - 26, 108, 52, "detect-changes", ["filtra por ruta;", "shared/ → todos"])
    jobs = [("node-services ×5", "lint · tipos · migraciones · tests"),
            ("python-service", "ruff · mypy · tests · cobertura"),
            ("mobile", "tests (Jest)"),
            ("admin-web", "lint · tipos · tests · build")]
    jy = [y + 6 + i * 48 for i in range(4)]
    fan(268, y + h / 2, 300, [v + 20 for v in jy])
    for (nom, sub), v in zip(jobs, jy):
        caja(300, v, 190, 40, nom, [sub])
    s.append(t(395, y + h + 3, "Postgres y Redis reales como servicios del job", 7.6, color=INK6))
    fan_in(490, [v + 20 for v in jy], 520, y + h / 2)
    caja(520, y + h / 2 - 30, 104, 60, "tests-summary", ["bloquea el merge", "si un job falla"], LIME)
    fl(624, y + h / 2, 640, y + h / 2)
    caja(640, y + h / 2 - 38, 108, 76, "Merge", ["squash, tras la", "revisión de otro", "integrante"],
         BLANCO, INK, False)

    # ── Carriles 2 y 3: push a develop y a main ──
    def despliegue(y, rama_txt, workflow, etiqueta, destino, destino_sub):
        h = 134
        carril(y, h, rama_txt)
        disparador(y, h, f"Push a {rama_txt}", "merge de un PR", workflow)
        caja(160, y + h / 2 - 26, 108, 52, "detect-changes", ["construye solo", "lo afectado"])
        jy2 = [y + 14, y + h - 54]
        fan(268, y + h / 2, 300, [v + 20 for v in jy2])
        caja(300, jy2[0], 150, 40, "node-services ×5", [f"tests · imagen :{etiqueta} a GHCR"])
        caja(300, jy2[1], 150, 40, "python-service", [f"tests · imagen :{etiqueta} a GHCR"])
        fan_in(450, [v + 20 for v in jy2], 470, y + h / 2)
        pasos = [".env de Secrets Mgr.", "SCP compose y nginx", "prisma migrate", "pull · up -d", "image prune"]
        caja(470, y + 2, 156, h - 4, f"deploy-{etiqueta}", [], INK1)
        for i, p in enumerate(pasos):
            py = y + 24 + i * 21
            s.append(rect(480, py, 136, 16, BLANCO, INK2, 0.8, 8))
            s.append(t(488, py + 11.2, f"{i + 1}  {p}", 7.6, 500, INK, "start"))
        fl(626, y + h / 2, 642, y + h / 2)
        s.append(rect(642, y + h / 2 - 30, 106, 60, LIME if etiqueta == "prod" else LIME_SUAVE, INK, 1.2, 6))
        s.append(t(695, y + h / 2 - 8, destino, 9.2, 700))
        s.append(t(695, y + h / 2 + 6, destino_sub, 6.6, color=INK6))
        s.append(t(695, y + h / 2 + 18, "Docker Compose", 7.6, color=INK6))
        return y + h

    yb = despliegue(y + h + 30, "develop", "ci-dev.yml", "dev", "EC2 dev", "api-dev.movosend.app")
    yc = despliegue(yb + 30, "main", "ci-prod.yml", "prod", "EC2 prod", "api.movosend.app")
    s.append(t(400, yc + 20, "Además, todo push a main corre sync-main-to-develop.yml, que mantiene develop alineada con main.",
               7.6, color=INK6))

    # ── Carril 4: app móvil ──
    y4 = yc + 40
    h4 = 84
    carril(y4, h4, "tag")
    disparador(y4, h4, "Tag de git", "dev-* o v*", "mobile-eas.yml")
    caja(160, y4 + 2, 230, 36, "dev-*  →  dev-build", ["iOS y Android en paralelo"])
    caja(160, y4 + h4 - 38, 230, 36, "v*  →  testflight", ["build staging y TestFlight (iOS)"])
    fl(390, y4 + 20, 420, y4 + h4 / 2)
    fl(390, y4 + h4 - 20, 420, y4 + h4 / 2)
    caja(420, y4 + h4 / 2 - 22, 150, 44, "EAS Cloud", ["avisa el resultado", "por Telegram"], BLANCO, INK, False)
    s.append(rect(588, y4 + h4 / 2 - 22, 160, 44, BLANCO, INK4, 1, 6, 'stroke-dasharray="4 3"'))
    s.append(t(668, y4 + h4 / 2 - 5, "Panel movo-admin", 8.6, 700, INK6))
    s.append(t(668, y4 + h4 / 2 + 9, "lo compila Vercel", 7.6, color=INK6))
    H = y4 + h4 + 24
    guardar("gc-pipeline", W, H, s, flecha_defs(INK))


if __name__ == "__main__":
    ramas()
    pipeline()
