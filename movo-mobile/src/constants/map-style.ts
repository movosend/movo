/**
 * Estilo custom de Google Maps (blanco/grises, sin POIs de terceros) — look tipo
 * Uber/Cabify en vez del mapa default de Google (saturado, lleno de comercios).
 * Requiere `provider={PROVIDER_GOOGLE}` en el `MapView` (ver register.tsx): Apple Maps,
 * el default de `react-native-maps` en iOS, no soporta estilos JSON custom.
 *
 * Generado a mano con la paleta de `tailwind.config.js` (escala `ink`) como
 * referencia — mismos grises que el resto de la app, no una paleta aparte.
 */
export const movoMapStyleLight = [
  { elementType: "geometry", stylers: [{ color: "#F8F8FA" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8A8A93" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#FFFFFF" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#D5D5DB" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#FFFFFF" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#E6E6EA" }] },
  { featureType: "road.arterial", elementType: "labels.text.fill", stylers: [{ color: "#5A5A62" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#F1F1F3" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#D5D5DB" }] },
];

export const movoMapStyleDark = [
  { elementType: "geometry", stylers: [{ color: "#111113" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8A8A93" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0A0A0B" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#3A3A40" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#1A1A1D" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#27272B" }] },
  { featureType: "road.local", elementType: "geometry", stylers: [{ color: "#27272B" }] },
  { featureType: "road.local", elementType: "geometry.stroke", stylers: [{ color: "#3A3A40" }] },
  { featureType: "road.arterial", elementType: "labels.text.fill", stylers: [{ color: "#B4B4BC" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#27272B" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0A0A0B" }] },
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
