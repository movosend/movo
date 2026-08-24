import type { CreateAddressInput } from "../api/addresses-client";
import type { AddressSelection } from "../types/address-selection";

/**
 * `movo-svc-users/addresses.schema.ts#addressBodyProperties` exige
 * `street`/`streetNumber`/`city`/`province`/`postalCode`/`country` con `minLength: 1`
 * — nunca vacíos. Google Places solo devuelve `formattedAddress` como texto libre
 * (ej. "Av. Colón 1000, Córdoba, Córdoba, Argentina"), sin componentes
 * estructurados, así que no hay forma de completar esos campos con precisión.
 * Antes de este fix, `streetNumber` viajaba siempre `""` (nunca se separaba del
 * nombre de calle) y el 400 resultante hacía que el alta fallara en TODOS los
 * casos, no como una excepción — este placeholder explícito reemplaza los strings
 * vacíos que rompían la validación.
 */
const UNKNOWN_FIELD_PLACEHOLDER = "S/D";

const TRAILING_NUMBER_RE = /^(.*?)\s+(\d[\w-]*)$/;

/**
 * Convierte una `AddressSelection` (búsqueda Places, GPS, pin en mapa) al body de
 * `POST /addresses` — mismo criterio best-effort en los tres callers que guardan una
 * dirección a partir de una selección (`address-field.tsx` del wizard,
 * `confirm-add-address-sheet.tsx` de la pantalla de direcciones guardadas).
 */
export function addressSelectionToCreateInput(selection: AddressSelection): CreateAddressInput {
  const [firstSegment, ...rest] = selection.address.split(",").map((s) => s.trim());
  const streetSegment = firstSegment || selection.address;
  const match = streetSegment.match(TRAILING_NUMBER_RE);

  return {
    label: null,
    street: (match ? match[1] : streetSegment) || UNKNOWN_FIELD_PLACEHOLDER,
    streetNumber: match ? match[2] : UNKNOWN_FIELD_PLACEHOLDER,
    floorApartment: null,
    city: rest[0] || UNKNOWN_FIELD_PLACEHOLDER,
    province: rest[1] || UNKNOWN_FIELD_PLACEHOLDER,
    postalCode: UNKNOWN_FIELD_PLACEHOLDER,
    country: "Argentina",
    lat: selection.lat,
    long: selection.lng,
  };
}
