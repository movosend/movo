# CLAUDE.md — shared/movo-shared

Estado de implementación de `shared/movo-shared`. Ver el `CLAUDE.md` de la raíz del
repo para contexto general del proyecto (stack, ADRs, convenciones, git/PR). Entrada
corta por US: qué se hizo, en qué archivos, decisiones no obvias, qué queda pendiente.

## Estado actual de la implementación

### MOVO-67 — `@movo/shared`

JWT (`signAccessToken`/`verifyAccessToken`, TTL 60min), refresh token opaco, contrato
`ApiError`/`ApiErrorCode` (códigos nunca se renombran, solo se agregan), tipos de
dominio (`UserRole`, `KycStatus`, `AccountStatus`). Consumido como npm workspace por
gateway y servicios Node — el mobile lo importa siempre por subpath (ver MOVO-73), el
barrel raíz arrastra `jsonwebtoken`/`node:crypto`.
