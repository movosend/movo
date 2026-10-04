/**
 * Ciudades del juego del optimizador (prototipo de Claude Design "Movo Optimizador",
 * `movo-opt-data.js`). El servidor es la fuente de verdad de las coordenadas: con ellas
 * pide la matriz de cada ciudad una sola vez (ver `route-game-matrix-store.ts`).
 *
 * `version` entra en la clave de la cache de la matriz: si se cambia un punto o el orden
 * del pool, subir la versión para no cruzar índices con una matriz vieja.
 */

/** `[nombre, barrio, lat, lng]`, mismo formato que el prototipo. */
export type RouteGamePlace = readonly [name: string, zone: string, lat: number, lng: number];

export interface RouteGameScenario {
  id: string;
  version: number;
  city: string;
  zone: string;
  pool: readonly RouteGamePlace[];
}

export const ROUTE_GAME_SCENARIOS: readonly RouteGameScenario[] = [
  {
    id: "caba",
    version: 1,
    city: "CABA",
    zone: "Centro y Palermo",
    pool: [
      ["Obelisco", "San Nicolás", -34.6037, -58.3816],
      ["Plaza de Mayo", "Monserrat", -34.6083, -58.3712],
      ["Congreso", "Balvanera", -34.6098, -58.3925],
      ["Cementerio de Recoleta", "Recoleta", -34.5875, -58.3934],
      ["Plaza Italia", "Palermo", -34.5813, -58.4209],
      ["Planetario", "Palermo", -34.5697, -58.4116],
      ["Shopping Abasto", "Almagro", -34.6037, -58.4108],
      ["Parque Centenario", "Caballito", -34.6067, -58.4353],
      ["Plaza Dorrego", "San Telmo", -34.6206, -58.3717],
      ["Puente de la Mujer", "Puerto Madero", -34.6083, -58.3644],
      ["Estación Retiro", "Retiro", -34.5911, -58.3746],
      ["Plaza Serrano", "Palermo Soho", -34.5886, -58.4302],
    ],
  },
  {
    id: "rosario",
    version: 1,
    city: "Rosario",
    zone: "Centro y Fisherton",
    pool: [
      ["Monumento a la Bandera", "Centro", -32.9476, -60.6304],
      ["Parque Independencia", "Parque", -32.958, -60.656],
      ["Alto Rosario", "Refinería", -32.927, -60.669],
      ["Bv. Oroño y Pellegrini", "Centro", -32.956, -60.644],
      ["Barrio Echesortu", "Echesortu", -32.95, -60.68],
      ["Puerto Norte", "Puerto Norte", -32.93, -60.645],
      ["Terminal Mariano Moreno", "Lourdes", -32.9405, -60.6627],
      ["Plaza Sarmiento", "Centro", -32.951, -60.643],
      ["Ciudad Universitaria", "Barrio Sur", -32.964, -60.625],
    ],
  },
  {
    id: "cordoba",
    version: 1,
    city: "Córdoba",
    zone: "Centro y Cerro",
    pool: [
      ["Plaza San Martín", "Centro", -31.4167, -64.1836],
      ["Patio Olmos", "Centro", -31.4196, -64.1893],
      ["Parque Sarmiento", "Nueva Córdoba", -31.428, -64.178],
      ["Nuevo Centro Shopping", "Alberdi", -31.411, -64.201],
      ["Barrio Güemes", "Güemes", -31.427, -64.194],
      ["Ciudad Universitaria", "Ciudad Universitaria", -31.438, -64.19],
      ["Terminal de ómnibus", "Centro", -31.422, -64.174],
      ["Alta Córdoba", "Alta Córdoba", -31.396, -64.183],
      ["Cerro de las Rosas", "Cerro", -31.378, -64.234],
      ["Barrio General Paz", "General Paz", -31.41, -64.166],
    ],
  },
  {
    id: "mendoza",
    version: 1,
    city: "Mendoza",
    zone: "Ciudad y Godoy Cruz",
    pool: [
      ["Plaza Independencia", "Centro", -32.8894, -68.8448],
      ["Parque San Martín", "Parque", -32.892, -68.864],
      ["Mendoza Plaza Shopping", "Guaymallén", -32.896, -68.803],
      ["Terminal del Sol", "Guaymallén", -32.896, -68.83],
      ["Calle Arístides", "Quinta Sección", -32.883, -68.858],
      ["Barrio Bombal", "Godoy Cruz", -32.91, -68.85],
      ["Palmares", "Godoy Cruz", -32.96, -68.86],
      ["UNCuyo", "Parque", -32.882, -68.875],
      ["Mercado Central", "Guaymallén", -32.888, -68.818],
    ],
  },
  {
    id: "laplata",
    version: 1,
    city: "La Plata",
    zone: "Casco y Camino Belgrano",
    pool: [
      ["Plaza Moreno", "Casco", -34.9214, -57.9544],
      ["Estadio Único", "Casco", -34.9131, -57.989],
      ["Paseo del Bosque", "Bosque", -34.91, -57.933],
      ["Plaza Italia", "Casco", -34.911, -57.956],
      ["City Bell", "City Bell", -34.864, -58.046],
      ["Plaza Malvinas", "Casco", -34.929, -57.976],
      ["Gonnet", "Gonnet", -34.879, -58.02],
      ["Los Hornos", "Los Hornos", -34.96, -57.99],
      ["Tolosa", "Tolosa", -34.895, -57.97],
    ],
  },
];

export const ROUTE_GAME_SCENARIO_IDS = ROUTE_GAME_SCENARIOS.map((s) => s.id);

/** Paradas por partida (sin contar salida ni llegada). Todos los pools tienen ≥ 9 puntos. */
export const ROUTE_GAME_MIN_STOPS = 4;
export const ROUTE_GAME_MAX_STOPS = 7;

export function findScenario(id: string): RouteGameScenario | undefined {
  return ROUTE_GAME_SCENARIOS.find((s) => s.id === id);
}
