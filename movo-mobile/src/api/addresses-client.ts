import { httpClient } from "./http-client";
import type {
  Address,
  CreateAddressInput,
  UpdateAddressInput,
} from "@movo/shared/dist/types/address";

export type { Address, CreateAddressInput, UpdateAddressInput };

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
