# CLAUDE.md — docs/legal

Términos, Privacidad y su sincronización con la app. Contexto general del proyecto en el `CLAUDE.md` de la raíz.

### Legal y compliance: Términos y Condiciones, Política de Privacidad (MOVO-224)

Primeros borradores de `docs/legal/terminos-y-condiciones.md` y
`docs/legal/politica-privacidad.md` (base legal argentina: Ley 25.326, CCyCN
contrato de transporte de cosas, Ley 24.240), con aviso académico explícito y
`[A COMPLETAR]` donde falta un dato real (mecánica de penalidad, MOVO-226; el
de la comisión de MP lo cerró MOVO-225).
Documentos nuevos también subidos a Drive (`[Movo] NNN - Términos y
Condiciones`/`Política de Privacidad`) por el equipo. Decisiones no obvias:

- **Postura de responsabilidad deliberadamente agresiva** (TyC sección 13):
  MOVO se deslinda de pérdida/daño/robo del paquete en tránsito, atribuyendo
  esa responsabilidad exclusivamente al Transportista vía el contrato de
  transporte de cosas (CCyCN Arts. 1280-1318), en vez de fijar un tope
  monetario atado al valor declarado del envío. Es la postura que menos
  expone a MOVO en el texto, pero la que un tribunal tiene más margen para
  considerar abusiva frente a un Emisor-consumidor (Ley 24.240), dado que
  MOVO sí interviene en cobro, precio y disputas — riesgo documentado
  explícitamente en el propio documento, pendiente de validación por un
  abogado matriculado antes de cualquier lanzamiento real.
- **No inscripción ante el Registro Nacional de Bases de Datos (AAIP, Art. 21
  Ley 25.326)** mientras MOVO opere solo como proyecto académico sin
  producción real — riesgo regulatorio aceptado explícitamente, a revertir si
  MOVO pasa a operar con usuarios reales.
- **Derecho de arrepentimiento (Ley 24.240) declarado no aplicable** una vez
  aceptada una oferta, por encuadrar en la excepción del Art. 34 (servicio ya
  en ejecución con consentimiento expreso) — la protección equivalente es la
  cancelación sin cargo antes de aceptar una oferta (sección 10 del TyC).
- **Consentimiento diferenciado de KYC (dato biométrico/sensible) todavía no
  implementado como paso propio**: hoy queda cubierto por el checkbox general
  de Términos+Privacidad del registro (`movo-mobile`), no por un consentimiento
  puntual antes de iniciar el flujo de KYC — brecha documentada como pendiente
  en la propia Política de Privacidad (sección 3) en vez de quedar implícita.
  Mismo criterio aplicado a Google Analytics/Microsoft Clarity en la sección
  de cookies: listados como candidatas, no como herramientas ya integradas,
  porque no se verificó su integración real en `movo-admin` (institucional es
  repo separado).
- Registro/checkbox de aceptación, versionado (`LEGAL_DOCUMENT_VERSIONS`),
  persistencia de aceptación en `svc-users` y gate de re-aceptación: ver
  entradas de MOVO-224 en `shared/movo-shared/CLAUDE.md`,
  `services/movo-svc-users/HISTORIAL.md` y `movo-mobile/HISTORIAL.md`.
- Pendiente fuera de esta issue: footer con links legales en `movo-admin`
  (no existe todavía), purga automática de registros incompletos/KYC vencido
  (MOVO-230), y moderación de calificaciones (TyC sección 12) sin UI de
  reporte/edición todavía.

### Automatización de sync de documentos legales (`scripts/sync-legal-docs.ts`)

Cierra el pendiente de sync manual que MOVO-224/228 (`movo-mobile`) habían dejado
documentado: `docs/legal/*.md` (fuente redactada, pensada para lectura en Drive/
GitHub) se copiaba a mano a `movo-mobile/src/content/legal/*.ts` (empaquetado como
`string` — Metro no soporta importar `.md` sin transformer custom) y la fecha de
`LEGAL_DOCUMENT_VERSIONS` (`shared/movo-shared/src/config/legal.ts`, ADR implícito
de MOVO-228) se bumpeaba también a mano en sincronía con el `.md`. Tres lugares a
mantener alineados sin ningún mecanismo que lo forzara — mismo tipo de gap que ya
costó dos veces con env vars olvidadas (ver "Git, commits y PRs" más arriba).

- **`npm run sync:legal`** (raíz del repo, `tsx scripts/sync-legal-docs.ts`)
  regenera los 3 archivos a partir de `docs/legal/*.md`: las dos copias `.ts` de
  `movo-mobile` (contenido completo, escapado para template literal) y
  `LEGAL_DOCUMENT_VERSIONS` en `@movo/shared`, tomando la fecha de la línea
  **"Última actualización"** del propio `.md`. **`npm run sync:legal:check`**
  (mismo script con `--check`) no escribe nada, solo falla si algo quedó
  desincronizado — pensado para correr en CI o antes de un commit.
- **Decisión de diseño clave: la fecha de versión NUNCA se deriva de un hash/diff
  del contenido, se respeta la que el equipo escribió a mano en "Última
  actualización"** — un typo o una corrección de redacción menor en el `.md` no
  debería forzar re-aceptación a toda la base de usuarios (MOVO-229 dispara el
  gate de re-aceptación apenas la versión persistida de una cuenta quede vieja).
  El flujo real para publicar un cambio legal: editar el `.md`, bumpear a mano su
  línea de "Última actualización", correr `npm run sync:legal`, commitear los 3
  archivos regenerados juntos.
- Sin hook de pre-commit todavía (el repo no tiene Husky configurado pese a que
  la sección de convenciones de código lo menciona — gap preexistente, no
  introducido acá) — la propagación depende hoy de correr el script a mano o de
  agregarlo como paso de CI, todavía no hecho.
