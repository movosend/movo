import type { ActiveShipmentSummary } from "../api/shipments-client";
import type { AttentionTask } from "../hooks/use-attention-tasks";

/**
 * Fixtures de `app/dev-home-operativo.tsx` — galería de estados del home operativo
 * (MOVO-193), para verlo entero de una sola vez mientras MOVO-192 (backend real de
 * `/shipments/sending`/`/receiving`) sigue Todo. Un ítem por cada combinación
 * relevante de estado/badges de la matriz del AC5, no solo un ejemplo feliz.
 *
 * Los `id` llevan un sufijo numérico a propósito: `activeShipmentDisplayCode`
 * deriva el código del encabezado de los dígitos del `id` — sin ninguno, todos los
 * fixtures mostrarían el mismo `#MOVO-00000`.
 */

export const MOCK_SENDING_SHIPMENTS: ActiveShipmentSummary[] = [
  {
    id: "dev-sending-unfunded-48213",
    status: "assigned_unfunded",
    pickupDate: "2026-09-20",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    pickupAddress: "Av. Colón 1200, Córdoba",
    deliveryAddress: "Bv. San Juan 450, Córdoba",
    agreedPriceArs: 4500,
    counterparty: { name: "Nicolás Vera", initials: "NV" },
    isToday: false,
    pickupWindowExpired: false,
  },
  {
    id: "dev-sending-assigned-hoy-51302",
    status: "assigned",
    pickupDate: "2026-09-13",
    pickupTimeWindowStart: "14:00",
    pickupTimeWindowEnd: "18:00",
    pickupAddress: "Rosario de Santa Fe 650, Córdoba",
    deliveryAddress: "Duarte Quirós 1500, Córdoba",
    agreedPriceArs: 5200,
    counterparty: { name: "Lucía Gómez", initials: "LG" },
    isToday: true,
    pickupWindowExpired: false,
  },
  {
    id: "dev-sending-assigned-vencido-39871",
    status: "assigned",
    pickupDate: "2026-09-11",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    pickupAddress: "Obispo Trejo 800, Córdoba",
    deliveryAddress: "Vélez Sarsfield 200, Córdoba",
    agreedPriceArs: 3800,
    counterparty: { name: "Marta Ruiz", initials: "MR" },
    isToday: false,
    pickupWindowExpired: true,
  },
  {
    id: "dev-sending-in-transit-60214",
    status: "in_transit",
    pickupDate: "2026-09-13",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    pickupAddress: "Salta 330, Lanús",
    deliveryAddress: "San Martín 450, Córdoba",
    agreedPriceArs: 6100,
    counterparty: { name: "Juan Pereyra", initials: "JP" },
    isToday: false,
    pickupWindowExpired: false,
  },
];

export const MOCK_RECEIVING_SHIPMENTS: ActiveShipmentSummary[] = [
  {
    id: "dev-receiving-unfunded-77042",
    status: "assigned_unfunded",
    pickupDate: "2026-09-22",
    pickupTimeWindowStart: "10:00",
    pickupTimeWindowEnd: "13:00",
    pickupAddress: "Av. Rivadavia 5400, Buenos Aires",
    deliveryAddress: "Tu dirección",
    agreedPriceArs: 4900,
    counterparty: { name: "Julia Fernández", initials: "JF" },
    isToday: false,
    pickupWindowExpired: false,
  },
  {
    id: "dev-receiving-assigned-88530",
    status: "assigned",
    pickupDate: "2026-09-16",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    pickupAddress: "Córdoba 1200, Córdoba",
    deliveryAddress: "Tu dirección",
    agreedPriceArs: 5300,
    counterparty: { name: "Pedro Yorlano", initials: "PY" },
    isToday: false,
    pickupWindowExpired: false,
  },
  {
    id: "dev-receiving-in-transit-hoy-91007",
    status: "in_transit",
    pickupDate: "2026-09-13",
    pickupTimeWindowStart: "16:00",
    pickupTimeWindowEnd: "18:00",
    pickupAddress: "Bv. Illia 900, Córdoba",
    deliveryAddress: "Tu dirección",
    agreedPriceArs: 4100,
    counterparty: { name: "Alena Ariza", initials: "AA" },
    isToday: true,
    pickupWindowExpired: false,
  },
  {
    id: "dev-receiving-in-transit-vencido-25164",
    status: "in_transit",
    pickupDate: "2026-09-10",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "11:00",
    pickupAddress: "Chacabuco 700, Córdoba",
    deliveryAddress: "Tu dirección",
    agreedPriceArs: 3500,
    counterparty: { name: "Tomás Olmos", initials: "TO" },
    isToday: false,
    pickupWindowExpired: true,
  },
];

export const MOCK_ATTENTION_TASKS: AttentionTask[] = [
  {
    id: "dev-task-confirm",
    title: "Tenés un envío para confirmar",
    meta: "Av. Rivadavia 5400, Buenos Aires",
    primaryLabel: "Revisar",
    onPrimary: () => {},
  },
  {
    id: "dev-task-rejected",
    title: "El receptor rechazó tu envío",
    meta: "Vélez Sarsfield 200, Córdoba",
    primaryLabel: "Ver envío",
    onPrimary: () => {},
  },
];
