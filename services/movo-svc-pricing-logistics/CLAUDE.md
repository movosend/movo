# CLAUDE.md — services/movo-svc-pricing-logistics

Estado de implementación de `movo-svc-pricing-logistics`. Ver el `CLAUDE.md` de la raíz
del repo para contexto general del proyecto (stack, ADRs, convenciones, git/PR).
Entrada corta por US: qué se hizo, en qué archivos, decisiones no obvias, qué queda
pendiente.

## Estado actual de la implementación

### MOVO-50 — Spike: VRPTW con Google OR-Tools

Entregables en `docs/or-tools/` (`vrptw-spike-report.md`, `vrptw_prototype.py`).
Prefiltro geométrico al segmento de ruta (descarta candidatos >15km sin llamar a
OR-Tools/Google Maps). Cache de la solución del feed (0 llamados extra al aceptar una
oferta). SLA <50ms para 20 envíos, fallback greedy determinístico <0.2ms. Motivó
ADR-013 (Routes API sobre Distance Matrix).

### Pendiente / fuera de alcance

El servicio real (motor de pricing dinámico, subastas, VRPTW en producción) sigue
siendo solo un esqueleto — la fórmula de `suggestedPriceArs` que usa
`movo-svc-shipments` hoy es un placeholder temporal (ver
`services/movo-svc-shipments/CLAUDE.md`, MOVO-80).
