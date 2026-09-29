/**
 * Estilo custom de Google Maps (blanco/grises, sin POIs de terceros) — look tipo
 * Uber/Cabify en vez del mapa default de Google (saturado, lleno de comercios).
 * Requiere `provider={PROVIDER_GOOGLE}` en el `MapView` (ver register.tsx): Apple Maps,
 * el default de `react-native-maps` en iOS, no soporta estilos JSON custom.
 *
 * Generado a mano con la paleta de `tailwind.config.js` (escala `ink`) como
 * referencia — mismos grises que el resto de la app, no una paleta aparte.
 */
/**
 * Acento lima apagado (MOVO-257), siempre solo el relleno, sin nombre ni ícono:
 * - Parques, plazas y complejos deportivos (`poi.park`, `poi.sports_complex`).
 * - Zonas de referencia (hospitales, universidades/escuelas, aeropuertos) en un lima más
 *   lavado, para no confundirlas con un parque.
 * El resto de los POIs sigue apagado. No se pinta `landscape.natural`: se probó y teñía
 * casi todo el mapa (campos y sierras en rutas largas), perdiendo el look blanco/gris.
 */
const MAP_PARK_COLOR_LIGHT = "#E9F5C4";
const MAP_PARK_COLOR_DARK = "#1D2313";
const MAP_LANDMARK_COLOR_LIGHT = "#F1F7DC";
const MAP_LANDMARK_COLOR_DARK = "#191C13";

/** Avenidas (`road.arterial`): gris intermedio entre las calles locales y las autopistas. */
const MAP_ARTERIAL_COLOR_LIGHT = "#E4E4E9";
const MAP_ARTERIAL_COLOR_DARK = "#2E2E33";

function limeAreaRules(park: string, landmark: string) {
  const fill = (featureType: string, color: string) => ({
    featureType,
    elementType: "geometry",
    stylers: [{ visibility: "on" }, { color }],
  });
  return [
    fill("poi.park", park),
    fill("poi.sports_complex", park),
    fill("poi.medical", landmark),
    fill("poi.school", landmark),
    fill("transit.station.airport", landmark),
  ];
}

/**
 * Gris de las zonas urbanas (`landscape.man_made`: manzanas y áreas construidas), un
 * escalón más oscuro que el fondo en claro y más claro en oscuro, para que la ciudad se
 * distinga del campo sin sumar otro color. `road.highway` va bastante más marcado que
 * este gris, para que las autopistas no se pierdan dentro de la mancha urbana.
 */
const MAP_URBAN_COLOR_LIGHT = "#EEEEF1";
const MAP_URBAN_COLOR_DARK = "#18181B";

export const movoMapStyleLight = [
  { elementType: "geometry", stylers: [{ color: "#F8F8FA" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8A8A93" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#FFFFFF" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#D5D5DB" }] },
  { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: MAP_URBAN_COLOR_LIGHT }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#FFFFFF" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#E6E6EA" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: MAP_ARTERIAL_COLOR_LIGHT }] },
  { featureType: "road.arterial", elementType: "labels.text.fill", stylers: [{ color: "#5A5A62" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#CFCFD6" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#D5D5DB" }] },
  // Al final: tienen que pisar el `visibility: off` de `poi` y `transit` de arriba.
  ...limeAreaRules(MAP_PARK_COLOR_LIGHT, MAP_LANDMARK_COLOR_LIGHT),
];

export const movoMapStyleDark = [
  { elementType: "geometry", stylers: [{ color: "#111113" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8A8A93" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0A0A0B" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#3A3A40" }] },
  { featureType: "landscape.man_made", elementType: "geometry", stylers: [{ color: MAP_URBAN_COLOR_DARK }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1A1A1D" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#27272B" }] },
  { featureType: "road.local", elementType: "geometry", stylers: [{ color: "#27272B" }] },
  { featureType: "road.local", elementType: "geometry.stroke", stylers: [{ color: "#3A3A40" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: MAP_ARTERIAL_COLOR_DARK }] },
  { featureType: "road.arterial", elementType: "labels.text.fill", stylers: [{ color: "#B4B4BC" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3A3A40" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0A0A0B" }] },
  ...limeAreaRules(MAP_PARK_COLOR_DARK, MAP_LANDMARK_COLOR_DARK),
];

/**
 * Color de geometría base de cada estilo (el `elementType: "geometry"` de arriba).
 * Se usa como `backgroundColor` del contenedor del mapa para que, mientras la view
 * nativa todavía no pintó nada, el hueco tenga el color del mapa y no el del fondo
 * de la pantalla.
 */
export const MAP_GEOMETRY_COLOR_LIGHT = "#F8F8FA";
export const MAP_GEOMETRY_COLOR_DARK = "#111113";

/**
 * Sangrado del `MapView` respecto del contenedor que lo recorta
 * (`overflow-hidden` + `borderRadius`), en dp.
 *
 * La view nativa de Google Maps pinta su última fila de píxeles con su propio fondo
 * (`#F8F9FA`, gris-blanco) porque la superficie que renderiza queda una fracción de
 * píxel corta respecto de su frame. Eso se veía como una línea blanca de 1px físico
 * pegada al borde inferior de la card del mapa — invisible en tema claro (ese fondo
 * coincide casi exacto con `#F8F8FA`, la geometría del estilo claro) y muy notoria en
 * oscuro.
 *
 * No se puede tapar con un `backgroundColor`: lo pinta la propia view nativa, así que
 * cualquier fondo queda detrás. La solución es que ese borde propio del mapa caiga
 * **fuera** del recorte — se estira el `MapView` unos dp más allá del contenedor con
 * insets negativos y la máscara del contenedor se come el artefacto.
 *
 * Se aplica a los 4 lados (no solo abajo) para cubrir el mismo artefacto en cualquier
 * borde; el desplazamiento del centro visible es despreciable a esta escala.
 */
export const MAP_EDGE_BLEED = 2;
