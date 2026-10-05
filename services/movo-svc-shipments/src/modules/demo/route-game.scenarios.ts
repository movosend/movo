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
    version: 2,
    city: "CABA",
    zone: "Centro y Palermo",
    pool: [
      ["Obelisco", "San Nicolás", -34.6037, -58.3816],
      ["Plaza de Mayo", "Monserrat", -34.6085, -58.3722],
      ["Congreso", "Balvanera", -34.6098, -58.3927],
      ["Cementerio de Recoleta", "Recoleta", -34.5877, -58.3936],
      ["Plaza Italia", "Palermo", -34.5812, -58.4208],
      ["Planetario", "Palermo", -34.5697, -58.4117],
      ["Shopping Abasto", "Balvanera", -34.603, -58.4107],
      ["Parque Centenario", "Caballito", -34.6065, -58.4356],
      ["Plaza Dorrego", "San Telmo", -34.6205, -58.3718],
      ["Puente de la Mujer", "Puerto Madero", -34.608, -58.3647],
      ["Estación Retiro", "Retiro", -34.5912, -58.3747],
      ["Plaza Serrano", "Palermo Soho", -34.5888, -58.4301],
    ],
  },
  {
    id: "rosario",
    version: 2,
    city: "Rosario",
    zone: "Centro y Puerto Norte",
    pool: [
      ["Monumento a la Bandera", "Centro", -32.9476, -60.6308],
      ["Parque Independencia", "Parque", -32.9592, -60.66],
      ["Alto Rosario", "Refinería", -32.9275, -60.6684],
      ["Bv. Oroño y Pellegrini", "Lourdes", -32.954, -60.656],
      ["Plaza Ciro Echesortu", "Echesortu", -32.944, -60.6921],
      ["Puerto Norte", "Puerto Norte", -32.9233, -60.6644],
      ["Terminal Mariano Moreno", "Luis Agote", -32.9394, -60.6726],
      ["Plaza Sarmiento", "Centro", -32.949, -60.6424],
      ["Ciudad Universitaria", "República de la Sexta", -32.9675, -60.623],
    ],
  },
  {
    id: "cordoba",
    version: 2,
    city: "Córdoba",
    zone: "Centro y Cerro",
    pool: [
      ["Plaza San Martín", "Centro", -31.4167, -64.1836],
      ["Patio Olmos", "Centro", -31.4198, -64.1878],
      ["Parque Sarmiento", "Nueva Córdoba", -31.4295, -64.1767],
      ["Nuevocentro Shopping", "Alberdi", -31.4123, -64.2056],
      ["Paseo de las Artes", "Güemes", -31.424, -64.1927],
      ["Ciudad Universitaria", "Ciudad Universitaria", -31.4408, -64.1903],
      ["Terminal de ómnibus", "Centro", -31.4226, -64.1757],
      ["Plaza Rivadavia", "Alta Córdoba", -31.3915, -64.1848],
      ["Cerro de las Rosas", "Cerro", -31.3767, -64.2341],
      ["Plaza Alberdi", "General Paz", -31.4144, -64.1704],
    ],
  },
  {
    id: "mendoza",
    version: 2,
    city: "Mendoza",
    zone: "Ciudad y Godoy Cruz",
    pool: [
      ["Plaza Independencia", "Centro", -32.8897, -68.8445],
      ["Portones del Parque", "Parque", -32.8865, -68.8615],
      ["Mendoza Plaza Shopping", "Guaymallén", -32.9011, -68.7991],
      ["Terminal del Sol", "Guaymallén", -32.8947, -68.8302],
      ["Arístides y Belgrano", "Quinta Sección", -32.893, -68.851],
      ["Barrio Bombal", "Godoy Cruz", -32.9053, -68.848],
      ["Palmares Open Mall", "Godoy Cruz", -32.9556, -68.8589],
      ["UNCuyo", "Parque", -32.8774, -68.8753],
      ["Mercado Central", "Centro", -32.8851, -68.8416],
    ],
  },
  {
    id: "laplata",
    version: 2,
    city: "La Plata",
    zone: "Casco y Camino Belgrano",
    pool: [
      ["Plaza Moreno", "Casco", -34.9214, -57.9544],
      ["Estadio Único", "Tolosa", -34.9138, -57.989],
      ["Paseo del Bosque", "Bosque", -34.9079, -57.9348],
      ["Plaza Italia", "Casco", -34.9107, -57.9553],
      ["Plaza Belgrano", "City Bell", -34.8715, -58.0462],
      ["Plaza Malvinas", "Casco", -34.9275, -57.9613],
      ["Estación Gonnet", "Gonnet", -34.8799, -58.0105],
      ["Los Hornos", "Los Hornos", -34.9545, -57.9657],
      ["Estación Tolosa", "Tolosa", -34.8909, -57.9681],
    ],
  },
  {
    id: "mardelplata",
    version: 1,
    city: "Mar del Plata",
    zone: "Centro, Costa y Puerto",
    pool: [
      ["Casino Central", "Centro", -38.0042, -57.5424],
      ["Catedral", "Centro", -37.999, -57.549],
      ["Plaza Mitre", "La Loma", -38.0033, -57.5529],
      ["Torreón del Monje", "Playa Varese", -38.008, -57.5333],
      ["Paseo Aldrey", "Vieja Terminal", -38.0126, -57.5441],
      ["Villa Victoria Ocampo", "Los Troncos", -38.0197, -57.5528],
      ["Plaza del Agua", "Los Troncos", -38.0187, -57.5434],
      ["Playa Grande", "Playa Grande", -38.0287, -57.5314],
      ["Banquina de Pescadores", "Puerto", -38.0502, -57.5382],
      ["Estadio Minella", "Parque de Deportes", -38.0179, -57.5824],
      ["Plaza Rocha", "San Juan", -37.993, -57.5574],
      ["Terminal Ferroautomotora", "Estación Norte", -37.9883, -57.5639],
    ],
  },
  {
    id: "tucuman",
    version: 1,
    city: "Tucumán",
    zone: "Centro y Yerba Buena",
    pool: [
      ["Casa Histórica", "Centro", -26.833, -65.2043],
      ["Mercado del Norte", "Centro", -26.8273, -65.2074],
      ["Plaza Alberdi", "Centro", -26.8218, -65.2112],
      ["Parque 9 de Julio", "Parque", -26.827, -65.1861],
      ["Terminal de ómnibus", "El Bajo", -26.8356, -65.1938],
      ["Plaza Urquiza", "Barrio Norte", -26.8193, -65.2027],
      ["Estadio Monumental", "Barrio Norte", -26.8129, -65.1995],
      ["Hospital de Clínicas", "Villa Urquiza", -26.8012, -65.2049],
      ["Estadio La Ciudadela", "Ciudadela", -26.8362, -65.2298],
      ["Portal Tucumán", "Yerba Buena", -26.8222, -65.2679],
    ],
  },
  {
    id: "salta",
    version: 1,
    city: "Salta",
    zone: "Centro y San Bernardo",
    pool: [
      ["Plaza 9 de Julio", "Centro", -24.7893, -65.4103],
      ["Iglesia San Francisco", "Centro", -24.7901, -65.4078],
      ["Mercado San Miguel", "Centro", -24.7926, -65.4136],
      ["Paseo Balcarce", "Balcarce", -24.779, -65.4114],
      ["Alto NOA Shopping", "El Pilar", -24.7808, -65.4024],
      ["Monumento a Güemes", "El Pilar", -24.7868, -65.3992],
      ["Teleférico San Bernardo", "Parque San Martín", -24.7918, -65.3971],
      ["Terminal de ómnibus", "Parque San Martín", -24.7955, -65.3985],
      ["Estadio Martearena", "Sur", -24.8209, -65.4191],
      ["Universidad Nacional de Salta", "Castañares", -24.7266, -65.4075],
    ],
  },
  {
    id: "neuquen",
    version: 1,
    city: "Neuquén",
    zone: "Centro y Costa del Limay",
    pool: [
      ["Plaza de las Banderas", "Alto", -38.9375, -68.0589],
      ["Alto Comahue Shopping", "Centro Este", -38.9413, -68.0649],
      ["Universidad del Comahue", "Centro Este", -38.9395, -68.0503],
      ["Hospital Castro Rendón", "Centro Este", -38.9502, -68.0569],
      ["Catedral", "Centro", -38.9535, -68.0598],
      ["Parque Central", "Centro Sur", -38.9569, -68.057],
      ["Museo de Bellas Artes", "Centro Sur", -38.9566, -68.0534],
      ["Paseo Costero", "Costa del Limay", -38.9784, -68.0402],
      ["Terminal ETON", "Huiliches", -38.9558, -68.1053],
      ["Balcón del Valle", "Melipal", -38.9347, -68.1009],
    ],
  },
  {
    id: "santafe",
    version: 1,
    city: "Santa Fe",
    zone: "Centro y Costanera",
    pool: [
      ["Plaza 25 de Mayo", "Centro", -31.6574, -60.7105],
      ["Convento de San Francisco", "Centro", -31.6596, -60.71],
      ["Parque del Sur", "Sur", -31.6624, -60.7087],
      ["Terminal de ómnibus", "Candioti", -31.6433, -60.7003],
      ["Estación Belgrano", "Candioti Norte", -31.6389, -60.6866],
      ["Puente Colgante", "Costanera", -31.6401, -60.6812],
      ["Ciudad Universitaria UNL", "El Pozo", -31.6399, -60.6709],
      ["Estadio 15 de Abril", "Mariano Comas", -31.632, -60.7157],
      ["Parque Garay", "Parque Garay", -31.6365, -60.7199],
      ["Estadio Brigadier López", "Centenario", -31.6632, -60.7253],
      ["La Redonda", "Sargento Cabral", -31.6199, -60.6941],
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
