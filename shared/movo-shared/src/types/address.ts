/**
 * Wire contract de `users.address` (MOVO-73/MOVO-119, expuesto por
 * `movo-svc-users` bajo `/addresses`, MOVO-121 lo migra acá desde el cliente mobile
 * que lo tenía duplicado). `createdAt`/`updatedAt` son `string` (ISO), no `Date` —
 * este es el shape ya serializado en la respuesta HTTP, no el modelo interno del
 * backend (que sí usa `Date`, ver `services/movo-svc-users/src/models/address.ts`).
 */
export interface Address {
  id: string;
  label: string | null;
  isDefault: boolean;
  street: string;
  streetNumber: string;
  floorApartment: string | null;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  lat: number;
  long: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Body de `POST /addresses` — `isDefault` es opcional a propósito: la primera
 * dirección de un usuario se fuerza `true` sin importar lo que mande el cliente
 * (ver `address-repository.ts#create` en `movo-svc-users`).
 */
export interface CreateAddressInput {
  label?: string | null;
  isDefault?: boolean;
  street: string;
  streetNumber: string;
  floorApartment?: string | null;
  city: string;
  province: string;
  postalCode: string;
  country: string;
  lat: number;
  long: number;
}

/**
 * Body de `PATCH /addresses/:id` — update parcial, cualquier campo de
 * `CreateAddressInput` salvo `isDefault`, que solo acepta `true` (el backend
 * responde 400 ante `isDefault: false` — no hay forma de desmarcar una default
 * explícitamente, solo se desmarca automáticamente cuando otra pasa a serlo).
 */
export type UpdateAddressInput = Partial<Omit<CreateAddressInput, "isDefault">> & {
  isDefault?: true;
};
