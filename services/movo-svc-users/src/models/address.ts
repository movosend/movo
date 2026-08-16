/** Fila de `users.address` (MOVO-73/MOVO-119) — libreta de direcciones 1:N desde
 * User, con a lo sumo una fila `isDefault: true` por usuario (índice único parcial,
 * ver migración de MOVO-119). */
export interface Address {
  id: string;
  userId: string;
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
  createdAt: Date;
  updatedAt: Date;
}

/** Body de `POST /addresses` — `isDefault` es opcional a propósito: la primera
 * dirección de un usuario se fuerza `true` sin importar lo que mande el cliente
 * (ver `address-repository.ts#create`). */
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

/** Body de `PATCH /addresses/:id` — update parcial, cualquier campo declarado en
 * `CreateAddressInput` salvo `isDefault`, que sí puede pasarse para forzar el swap
 * atómico de default (nunca para desmarcarla explícitamente: `addresses.schema.ts`
 * declara `isDefault: { enum: [true] }` en `updateBody`, así que `isDefault: false`
 * no se ignora -- AJV lo rechaza con 400 antes de llegar al service). */
export type UpdateAddressInput = Partial<
  Omit<CreateAddressInput, "isDefault">
> & {
  isDefault?: true;
};
