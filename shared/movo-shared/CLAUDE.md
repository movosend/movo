# CLAUDE.md — shared/movo-shared

Estado de implementación de `shared/movo-shared`. Ver el `CLAUDE.md` de la raíz del
repo para contexto general del proyecto (stack, ADRs, convenciones, git/PR).

Después de cambiar un tipo o una función de acá, `npm run build` en este paquete antes de tipar desde otro workspace:
los servicios y el panel importan el `dist/`.

## Historial de implementación

El historial por US (qué se hizo, en qué archivos, decisiones no obvias, qué quedó pendiente) vive en `HISTORIAL.md`, al lado de este archivo, y **no se carga solo**. Antes de tocar un tipo o un contrato, buscá con grep en `HISTORIAL.md` su MOVO-id, nombre de archivo o concepto: muchas entradas documentan gotchas y decisiones que el código no explica. Al cerrar una US, la entrada nueva va al final de `HISTORIAL.md` (skill `cerrar-us`).
