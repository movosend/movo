# ADR-025 — Convención de los reportes del panel (borrador)

**Estado:** aceptado (MOVO-342). Complementa ADR-001 (microservicios) y la decisión 6 de MOVO-286 (el panel solo habla con
`svc-admin`), sin modificarlos. Pasar al entregable de Drive (`[Movo] 004 - Sprint 0.md`) cuando se cierre la US.

## Contexto

El panel va a tener varios reportes: la exportación de la bitácora y la home (MOVO-342), el reporte de disputas (MOVO-344) y las
métricas (MOVO-35). Los datos viven en esquemas de servicios distintos (ADR-003) y ningún servicio puede leer el esquema de otro.
Hacía falta fijar antes del primero dónde se calcula cada número, quién arma el archivo y si se guardan agregados. El contrato
del lado del panel lo propuso MOVO-345 (comentarios en MOVO-342 y MOVO-344).

## Decisión

1. **Los agregados se calculan en el servicio dueño de los datos**, en un endpoint interno (`/internal/admin/...`, o
   `/internal/payments/admin/...` en pagos). El SQL de un conteo vive junto a su tabla; ningún otro servicio recalcula a partir de
   filas sueltas.
2. **`svc-admin` orquesta**: valida el rango y los filtros, pide en paralelo a cada servicio dueño, resuelve nombres y arma la
   respuesta. Una vista que combina fuentes (la home, `GET /admin/overview`) devuelve un bloque `{ data, error }` por fuente, con
   el `requestId` en el error: una fuente caída no tumba el resto.
3. **El CSV se genera en el backend**, en `svc-admin` (`utils/csv.ts`), con los mismos filtros y el mismo orden que el listado que
   exporta: el archivo coincide con lo que se ve en pantalla. Celdas escapadas contra inyección de fórmulas (`=`, `+`, `-`, `@`, tab,
   CR). **Tope de filas con aviso**: `CSV_MAX_ROWS` (10.000) corta el archivo y `X-Export-Rows` / `X-Export-Truncated` lo informan,
   para que el panel avise; el corte conserva las filas más recientes.
4. **Rango de fechas común** (`@movo/shared`, `types/admin-reports.ts`): días `YYYY-MM-DD` inclusivos, en hora de Argentina, con
   `from ≤ to ≤ hoy` y tope de 366 días. Un rango inválido es 400 `REPORT_RANGE_INVALID` con `details.reason`. El período anterior
   tiene el mismo largo y va inmediatamente antes; la granularidad la decide el backend (día hasta 31 días, semana hasta 120, mes el
   resto).
5. **Sin tablas precalculadas**: cada número se calcula al pedirlo. Lo que no se puede reconstruir con fechas (p. ej. "cuántas había
   ayer" en una bandeja sin historial) viaja en `null`, no estimado.
6. **Cada exportación queda en la bitácora** (`report.export`, objetivo `report`), porque un CSV saca datos del sistema. El listado
   en pantalla no se audita: es una lectura.

## Alternativas consideradas

- **Réplica de lectura o vistas cruzadas entre esquemas** para que `svc-admin` consulte directo: rompe el aislamiento por esquema de
  ADR-003 y acopla `svc-admin` al modelo interno de cada servicio.
- **Tablas de agregados precalculadas por un barrido**: con el volumen del TFG la consulta en vivo alcanza, y una tabla
  precalculada suma la pregunta de qué tan desactualizada está.
- **CSV armado en el navegador** (`movo-admin`) a partir de las páginas del listado: obliga a paginar todo desde el cliente, no
  permite auditar la exportación y duplica el escape en cada pantalla.
- **Rechazar con un error la exportación que pasa el tope** (la primera versión de MOVO-342): un archivo nunca recortado, pero el
  admin se queda sin datos. Se prefirió cortar y avisar, como pidió el panel.

## Trade-offs aceptados

- Cada reporte cuesta una consulta en vivo al servicio dueño. Si uno se vuelve caro se le agrega un índice o, recién entonces, una
  tabla precalculada con su propio ADR.
- Una exportación cortada no trae las filas más viejas: hay que acotar con filtros para llegar a ellas. No hay exportación en
  segundo plano.
- La fila de la bitácora de una exportación se escribe después de leer, así que no aparece en el CSV que la generó.
