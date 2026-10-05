# Navegación turn-by-turn del transportista

Implementación de [MOVO-237](https://linear.app/movosend/issue/MOVO-237) (ver **ADR-033**,
`CLAUDE.md` raíz). Cierra el "fuera de alcance" que dejó MOVO-207 (mapa de ruta
optimizada): la navegación paso a paso hasta cada parada.

## Decisión: deep-link, no navegación in-app

Movo no navega: delega en la app de mapas que el transportista ya tiene instalada.
Cada parada seleccionada en "Mi ruta" (`movo-mobile/components/route/stop-list.tsx`)
ofrece un botón **Navegar** (`components/route/navigate-button.tsx`) que abre, en este
orden, la primera app que acepte el link (`src/lib/navigation-deeplink.ts`):

| Orden | App | URL |
| --- | --- | --- |
| 1 | Google Maps (Android) | `google.navigation:q=lat,lng` |
| 1 | Google Maps (iOS) | `comgooglemaps://?daddr=lat,lng&directionsmode=driving` |
| 2 | Waze | `waze://?ll=lat,lng&navigate=yes` |
| 3 | Browser | `https://www.google.com/maps/dir/?api=1&destination=lat,lng&travelmode=driving` |

La cascada se resuelve probando `Linking.openURL` en orden, sin `canOpenURL`: ese
último exige declarar los schemes (`LSApplicationQueriesSchemes` en iOS, `<queries>`
en Android 11+), o sea un build nativo nuevo, mientras que `openURL` ya falla solo
cuando no hay ninguna app que maneje la URL.

**Costo para Movo: cero.** El botón no llama a Compute Routes ni al Navigation SDK; el
re-routing, el tráfico y las indicaciones por voz los resuelve la app externa.

El mapa ya no tiene un botón "Abrir en Maps" para el recorrido completo: el rediseño de
la pantalla (mockup 2a de Claude Design) lo sacó porque duplicaba a "Navegar", que es lo
que se usa parada por parada.

## `RoutesProvider.mode`: `per_trip` y `live`

`services/movo-svc-shipments/src/adapters/routes-provider.ts` distingue dos modos de
consumo de la Google Routes API:

- **`per_trip`** (default, el único implementado): una llamada estática por par
  origen→destino o por recálculo de paradas, para dibujar el polyline en el mapa
  propio de Movo (MOVO-123). Tier Basic, ~US$5/1.000 llamadas tras el free tier,
  1-3 llamadas por viaje. Los callers existentes no pasan `mode` y no cambian.
- **`live`**: re-routing continuo tipo Waze. **Es un placeholder intencional, no una
  funcionalidad recortada por error.** Queda en el tipo para no rediseñar el contrato
  si algún día se decide una navegación 100% in-app, pero pedirlo falla con
  `501 ROUTE_MODE_NOT_IMPLEMENTED` antes de cualquier llamada facturable, en vez de
  fingir soporte.

Por qué no se implementa `live`: el deep-link cubre la necesidad real del transportista
a costo cero. La alternativa in-app sería el Navigation SDK (~US$25/1.000, cinco veces
más que Compute Routes) o reimplementar re-routing en loop sobre Compute Routes. Ninguna
se justifica mientras no haya una razón de producto para mantener al transportista
dentro de la app durante el trayecto.

## Fuera de alcance

- Preferencia persistida de app de navegación por usuario (Maps vs. Waze): se usa el
  orden de fallback de arriba.
- Implementación real del modo `live`.
