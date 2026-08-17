import { httpClient } from "./http-client";

/**
 * Contrato propuesto en MOVO-119 (`[movo-svc-users] CRUD de direcciones guardadas
 * (/addresses)`) — backend todavía sin implementar al momento de escribir este
 * cliente (MOVO-83). Se implementa ya contra el contrato propuesto para que, al
 * cerrarse MOVO-119, el mobile funcione sin cambios — mientras tanto estas llamadas
 * fallan (404/otro) y los callers (`use-addresses.ts`) degradan a "sin direcciones
 * guardadas" en vez de romper el wizard.
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

export type CreateAddressInput = Omit<Address, "id" | "createdAt" | "updatedAt">;
export type UpdateAddressInput = Partial<CreateAddressInput>;

export const addressesClient = {
  /** Protegida — `httpClient` adjunta `Authorization` automáticamente (MOVO-76). */
  list(): Promise<Address[]> {
    return httpClient.get<Address[]>("/addresses");
  },

  create(body: CreateAddressInput): Promise<Address> {
    return httpClient.post<Address>("/addresses", body);
  },

  update(id: string, body: UpdateAddressInput): Promise<Address> {
    return httpClient.patch<Address>(`/addresses/${id}`, body);
  },

  remove(id: string): Promise<void> {
    return httpClient.delete<void>(`/addresses/${id}`);
  },
};
