import type { ImageSourcePropType } from "react-native";
import { normalizeSearchText } from "../data/vehicle-catalog";

/**
 * Logos reales de marca para el selector de vehículo (MOVO-223) — opcionales.
 * El mockup de referencia (Claude Design) usa un círculo con las iniciales de
 * la marca (`BrandAvatar`), no logos — esta tabla es una mejora sobre eso,
 * con los archivos que aportó el usuario en `assets/car-brands/` (PNG con
 * canal alfa real, ver `git log` de este archivo).
 *
 * Metro no soporta rutas dinámicas en `require()`, así que cada logo necesita
 * su propia línea acá. Para sumar uno nuevo: colocar el archivo en
 * `assets/car-brands/<slug>.png` (slug = nombre de marca en minúsculas, sin
 * espacios ni tildes — `citroën` → `citroen`; los guiones sí se conservan,
 * `Mercedes-Benz` → `mercedes-benz`) y agregar su entrada acá. Sin entrada
 * para una marca del catálogo, `BrandAvatar` cae sola al círculo de iniciales
 * del mockup — nunca rompe por un logo faltante (hoy no falta ninguna del
 * catálogo).
 */
const BRAND_ICONS: Partial<Record<string, ImageSourcePropType>> = {
  volkswagen: require("../../assets/car-brands/volkswagen.png"),
  toyota: require("../../assets/car-brands/toyota.png"),
  fiat: require("../../assets/car-brands/fiat.png"),
  renault: require("../../assets/car-brands/renault.png"),
  chevrolet: require("../../assets/car-brands/chevrolet.png"),
  ford: require("../../assets/car-brands/ford.png"),
  peugeot: require("../../assets/car-brands/peugeot.png"),
  citroen: require("../../assets/car-brands/citroen.png"),
  nissan: require("../../assets/car-brands/nissan.png"),
  honda: require("../../assets/car-brands/honda.png"),
  jeep: require("../../assets/car-brands/jeep.png"),
  hyundai: require("../../assets/car-brands/hyundai.png"),
  kia: require("../../assets/car-brands/kia.png"),
  suzuki: require("../../assets/car-brands/suzuki.png"),
  "mercedes-benz": require("../../assets/car-brands/mercedes-benz.png"),
  iveco: require("../../assets/car-brands/iveco.png"),
  chery: require("../../assets/car-brands/chery.png"),
  byd: require("../../assets/car-brands/byd.png"),
  jac: require("../../assets/car-brands/jac.png"),
};

export function getBrandIconSource(brand: string): ImageSourcePropType | undefined {
  return BRAND_ICONS[normalizeSearchText(brand)];
}
