/**
 * Catálogo estático de marcas/modelos comunes en Argentina y volúmenes de carga
 * estándar por modelo (MOVO-223). Reemplaza la carga libre de marca/modelo/
 * capacidad de MOVO-172 por una selección acotada, con el volumen ya calculado.
 *
 * Estático en el mobile a propósito (decisión tomada con el usuario): no existe
 * ningún catálogo de referencia en ningún servicio del monorepo hoy, y el
 * volumen de datos es chico y cambia poco — no justifica una tabla/endpoint
 * nuevo en `movo-svc-users` para un ticket de este tamaño. El backend no
 * necesita cambios: sigue aceptando `brand`/`model`/`cargoCapacityLabel` como
 * strings libres (`VehicleProfile` de `@movo/shared`), el mobile solo le manda
 * ahora valores que salen de acá en vez de texto libre del usuario.
 *
 * Cobertura: combina el ranking de ventas ACARA 2026 (0km) con el parque
 * automotor instalado (autos de generaciones anteriores que siguen
 * circulando en gran número — Argentina tiene una edad promedio de parque
 * alta) y los utilitarios de carga relevantes para una plataforma de
 * logística P2P. No es exhaustivo al 100% — un selector con 300 entradas
 * deja de ser usable — pero cubre la enorme mayoría de casos reales.
 *
 * IMPORTANTE: la UI que consuma este catálogo debe ofrecer una salida tipo
 * "mi auto no está en la lista" que permita carga libre (el backend ya la
 * soporta). Ningún catálogo, por más grande que sea, va a cubrir el 100% de
 * los casos, y sin ese fallback el alta de ficha se rompe para esos usuarios.
 */

export interface CargoTier {
  id: string;
  cap: string;
  ex: string;
}

export const CARGO_TIERS: CargoTier[] = [
  { id: "S", cap: "Hasta 5 kg · 20 L", ex: "Un sobre, documentos, una mochila chica" },
  { id: "M", cap: "Hasta 15 kg · 60 L", ex: "Una caja mediana o un bolso de viaje" },
  { id: "L", cap: "Hasta 40 kg · 180 L", ex: "Baúl completo: 2 cajas de mudanza" },
  { id: "XL", cap: "Hasta 150 kg · 600 L", ex: "Caja de pickup: un electrodoméstico grande" },
  { id: "XXL", cap: "Hasta 400 kg · 1.500 L", ex: "Furgón chico: mudanza pequeña, pallet chico" },
  { id: "XXXL", cap: "Hasta 1.500 kg · 8.000 L", ex: "Furgón grande: mudanza de un ambiente, varios pallets" },
];

export interface CatalogModel {
  name: string;
  segment: string;
  tierId: string;
}

export const VEHICLE_CATALOG: Record<string, CatalogModel[]> = {
  Volkswagen: [
    { name: "Up!", segment: "Hatchback chico", tierId: "S" },
    { name: "Gol Trend", segment: "Hatchback", tierId: "M" },
    { name: "Polo", segment: "Hatchback", tierId: "M" },
    { name: "Suran", segment: "Monovolumen", tierId: "M" },
    { name: "Voyage", segment: "Sedán", tierId: "L" },
    { name: "Virtus", segment: "Sedán", tierId: "L" },
    { name: "Vento", segment: "Sedán", tierId: "L" },
    { name: "T-Cross", segment: "SUV", tierId: "L" },
    { name: "Taos", segment: "SUV", tierId: "L" },
    { name: "Tera", segment: "SUV", tierId: "L" },
    { name: "Nivus", segment: "SUV coupé", tierId: "L" },
    { name: "Amarok", segment: "Pickup", tierId: "XL" },
    { name: "Saveiro", segment: "Pickup chica", tierId: "XL" },
    { name: "Transporter", segment: "Furgón mediano", tierId: "XXXL" },
    { name: "Crafter", segment: "Furgón grande", tierId: "XXXL" },
  ],
  Toyota: [
    { name: "Etios", segment: "Hatchback", tierId: "M" },
    { name: "Yaris", segment: "Hatchback", tierId: "M" },
    { name: "Corolla", segment: "Sedán", tierId: "L" },
    { name: "Yaris Cross", segment: "SUV", tierId: "L" },
    { name: "Corolla Cross", segment: "SUV", tierId: "L" },
    { name: "SW4", segment: "SUV grande", tierId: "L" },
    { name: "Hilux", segment: "Pickup", tierId: "XL" },
    { name: "Hiace", segment: "Furgón grande", tierId: "XXXL" },
  ],
  Ford: [
    { name: "Ka", segment: "Hatchback", tierId: "M" },
    { name: "Fiesta", segment: "Hatchback", tierId: "M" },
    { name: "Focus", segment: "Hatchback", tierId: "L" },
    { name: "EcoSport", segment: "SUV", tierId: "L" },
    { name: "Territory", segment: "SUV", tierId: "L" },
    { name: "Ranger", segment: "Pickup", tierId: "XL" },
    { name: "F-100", segment: "Pickup clásica", tierId: "XL" },
    { name: "Transit", segment: "Furgón grande", tierId: "XXXL" },
  ],
  Chevrolet: [
    { name: "Onix", segment: "Hatchback", tierId: "M" },
    { name: "Corsa Classic", segment: "Hatchback/Sedán", tierId: "M" },
    { name: "Onix Plus", segment: "Sedán", tierId: "L" },
    { name: "Prisma", segment: "Sedán", tierId: "L" },
    { name: "Cruze", segment: "Sedán", tierId: "L" },
    { name: "Tracker", segment: "SUV", tierId: "L" },
    { name: "Spin", segment: "Monovolumen", tierId: "L" },
    { name: "S10", segment: "Pickup", tierId: "XL" },
    { name: "Montana", segment: "Pickup chica", tierId: "XL" },
  ],
  Fiat: [
    { name: "Mobi", segment: "Hatchback chico", tierId: "S" },
    { name: "Uno", segment: "Hatchback", tierId: "M" },
    { name: "Argo", segment: "Hatchback", tierId: "M" },
    { name: "Siena", segment: "Sedán", tierId: "M" },
    { name: "Cronos", segment: "Sedán", tierId: "L" },
    { name: "Pulse", segment: "SUV", tierId: "L" },
    { name: "Toro", segment: "Pickup", tierId: "XL" },
    { name: "Strada", segment: "Pickup chica", tierId: "XL" },
    { name: "Fiorino", segment: "Furgón chico", tierId: "XXL" },
    { name: "Ducato", segment: "Furgón grande", tierId: "XXXL" },
  ],
  Renault: [
    { name: "Kwid", segment: "Hatchback chico", tierId: "S" },
    { name: "Sandero", segment: "Hatchback", tierId: "M" },
    { name: "Stepway", segment: "Hatchback alto", tierId: "M" },
    { name: "Clio", segment: "Hatchback", tierId: "M" },
    { name: "Logan", segment: "Sedán", tierId: "L" },
    { name: "Symbol", segment: "Sedán", tierId: "L" },
    { name: "Megane", segment: "Hatchback/Sedán", tierId: "L" },
    { name: "Duster", segment: "SUV", tierId: "L" },
    { name: "Captur", segment: "SUV", tierId: "L" },
    { name: "Alaskan", segment: "Pickup", tierId: "XL" },
    { name: "Kangoo", segment: "Furgón chico", tierId: "XXL" },
    { name: "Master", segment: "Furgón grande", tierId: "XXXL" },
  ],
  Peugeot: [
    { name: "206/207", segment: "Hatchback", tierId: "M" },
    { name: "208", segment: "Hatchback", tierId: "M" },
    { name: "308", segment: "Hatchback", tierId: "L" },
    { name: "408", segment: "Sedán", tierId: "L" },
    { name: "2008", segment: "SUV", tierId: "L" },
    { name: "3008", segment: "SUV", tierId: "L" },
    { name: "Partner", segment: "Furgón chico", tierId: "XXL" },
    { name: "Expert", segment: "Furgón mediano", tierId: "XXXL" },
    { name: "Boxer", segment: "Furgón grande", tierId: "XXXL" },
  ],
  Citroën: [
    { name: "C3", segment: "Hatchback", tierId: "M" },
    { name: "C3 Aircross", segment: "SUV", tierId: "L" },
    { name: "C4 Cactus", segment: "SUV", tierId: "L" },
    { name: "C4 Lounge", segment: "Sedán/Fastback", tierId: "L" },
    { name: "Berlingo", segment: "Furgón chico", tierId: "XXL" },
    { name: "Jumpy", segment: "Furgón mediano", tierId: "XXXL" },
    { name: "Jumper", segment: "Furgón grande", tierId: "XXXL" },
  ],
  Nissan: [
    { name: "March", segment: "Hatchback", tierId: "M" },
    { name: "Versa", segment: "Sedán", tierId: "L" },
    { name: "Sentra", segment: "Sedán", tierId: "L" },
    { name: "Kicks", segment: "SUV", tierId: "L" },
    { name: "Frontier", segment: "Pickup", tierId: "XL" },
  ],
  Honda: [
    { name: "Fit", segment: "Hatchback", tierId: "M" },
    { name: "City", segment: "Sedán", tierId: "L" },
    { name: "Civic", segment: "Sedán", tierId: "L" },
    { name: "HR-V", segment: "SUV", tierId: "L" },
    { name: "CR-V", segment: "SUV", tierId: "L" },
  ],
  Jeep: [
    { name: "Renegade", segment: "SUV", tierId: "L" },
    { name: "Compass", segment: "SUV", tierId: "L" },
  ],
  Hyundai: [
    { name: "HB20", segment: "Hatchback", tierId: "M" },
    { name: "Creta", segment: "SUV", tierId: "L" },
    { name: "Tucson", segment: "SUV", tierId: "L" },
    { name: "H1", segment: "Furgón/combi", tierId: "XXXL" },
  ],
  Kia: [
    { name: "Picanto", segment: "Hatchback chico", tierId: "S" },
    { name: "Rio", segment: "Hatchback", tierId: "M" },
    { name: "Cerato", segment: "Sedán", tierId: "L" },
    { name: "Sportage", segment: "SUV", tierId: "L" },
  ],
  Suzuki: [{ name: "Fun", segment: "Hatchback chico", tierId: "S" }],
  "Mercedes-Benz": [
    { name: "Vito", segment: "Furgón mediano", tierId: "XXXL" },
    { name: "Sprinter", segment: "Furgón grande", tierId: "XXXL" },
  ],
  Iveco: [{ name: "Daily", segment: "Furgón grande", tierId: "XXXL" }],
  Chery: [
    { name: "Tiggo 2", segment: "SUV chico", tierId: "L" },
    { name: "Tiggo 7", segment: "SUV", tierId: "L" },
  ],
  BYD: [
    { name: "Dolphin", segment: "Hatchback eléctrico", tierId: "M" },
    { name: "Song Plus", segment: "SUV eléctrico", tierId: "L" },
  ],
  JAC: [
    { name: "S2", segment: "SUV chico", tierId: "L" },
    { name: "T40", segment: "Pickup", tierId: "XL" },
  ],
};

export const VEHICLE_BRANDS = Object.keys(VEHICLE_CATALOG);

const FALLBACK_TIER: CargoTier = { id: "?", cap: "Volumen a confirmar", ex: "" };

/**
 * Resuelve un tier por id. Nunca explota con un id desconocido (ficha vieja de
 * MOVO-172 con `cargoCapacityLabel` libre, o dato corrupto) — cae a un tier
 * "?" neutro en vez de romper la pantalla.
 */
export function tierById(id: string): CargoTier {
  return CARGO_TIERS.find((t) => t.id === id) ?? FALLBACK_TIER;
}

/**
 * Resuelve un tier a partir del `cargoCapacityLabel` persistido — es el único
 * campo que sobrevive al guardar (`VehicleProfile` no tiene columna de tier).
 * Si el texto no matchea ningún tier del catálogo (ficha vieja pre-MOVO-223,
 * cargada a mano, o el label de un tier que cambió de redacción), se muestra
 * igual el texto crudo con badge "?". Es una fragilidad conocida y aceptada:
 * cualquier cambio futuro en la redacción de `cap` en CARGO_TIERS rompe el
 * matching de fichas viejas. Si eso pasa con frecuencia, conviene persistir
 * el `tierId` además del label en vez de derivarlo por texto.
 */
export function tierFromLabel(label: string): CargoTier {
  return CARGO_TIERS.find((t) => t.cap === label) ?? { id: "?", cap: label, ex: "" };
}

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function brandInitials(brand: string): string {
  return brand.slice(0, 2).toUpperCase();
}

export const FITS_BY_TIER: Record<string, string[]> = {
  S: ["Sobres y documentos", "Una mochila o cartera", "Hasta 2 paquetes chicos por viaje"],
  M: ["Una caja mediana (60 × 40 × 30 cm)", "Un bolso de viaje", "Hasta 3 paquetes chicos por viaje"],
  L: ["2 cajas de mudanza en el baúl", "Una valija grande", "Hasta 5 paquetes por viaje"],
  XL: ["Un electrodoméstico grande", "Bultos largos hasta 2 m", "Hasta 8 paquetes por viaje"],
  XXL: ["Mudanza chica o un pallet chico", "Muebles desarmados", "Carga voluminosa sin límite de bultos"],
  XXXL: ["Mudanza completa de un ambiente", "Varios pallets", "Carga industrial o de gran volumen"],
};