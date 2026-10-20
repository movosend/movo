import type { TourDefinition } from "./types";

/**
 * MOVO-169, Tour 2 "Cómo transportar". Se dispara en el tab Transportar con todos los
 * requisitos completos. Sin paso de "Mi ruta de hoy": desde MOVO-314 la ruta optimizada
 * se abre por viaje, así que se explica en el paso de "Mis viajes".
 */
export const CARRIER_TOUR: TourDefinition = {
  id: "carrier",
  version: 1,
  icon: "truck",
  steps: [
    {
      id: "welcome",
      route: "/transport",
      title: "¡Ya podés transportar!",
      body: "Te mostramos cómo encontrar paquetes que te quedan de paso.",
    },
    {
      id: "trips",
      route: "/transport",
      anchorId: "transport-my-trips",
      title: "Declará tu recorrido",
      body: "Contanos cuándo y por dónde vas a viajar y te avisamos apenas aparezca un paquete en tu ruta. Desde cada viaje vas a ver las paradas ordenadas para que hagas el menor recorrido posible.",
    },
    {
      id: "radius",
      route: "/transport",
      anchorId: "transport-radius-filters",
      title: "Explorá envíos cerca",
      body: "Elegí hasta dónde te querés desviar. Podés ordenar por menos desvío, mejor pago o más próximo.",
    },
    {
      id: "feed",
      route: "/transport",
      anchorId: "transport-first-row",
      when: ({ hasFeed }) => hasFeed,
      title: "Mirá el desvío y el pago",
      body: "Cada envío te muestra cuánto te desvía y el precio sugerido. Si te queda de paso en un viaje que declaraste, lo marcamos como En tu ruta. Tocalo para ofertar.",
    },
    {
      id: "offers",
      route: "/transport",
      anchorId: "transport-my-offers",
      title: "Seguí tus ofertas",
      body: "Acá ves cuáles están pendientes y cuáles te aceptaron.",
    },
  ],
};
