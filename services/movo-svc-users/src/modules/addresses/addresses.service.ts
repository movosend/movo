import { ApiError } from "@movo/shared";
import { PrismaClient } from "../../generated/prisma/client";
import { createAddressRepository } from "../../repositories/address-repository";
import {
  Address,
  CreateAddressInput,
  UpdateAddressInput,
} from "../../models/address";

export interface AddressesService {
  listMyAddresses(userId: string): Promise<Address[]>;
  createAddress(userId: string, input: CreateAddressInput): Promise<Address>;
  updateAddress(
    addressId: string,
    callerId: string,
    input: UpdateAddressInput,
  ): Promise<Address>;
  deleteAddress(addressId: string, callerId: string): Promise<void>;
}

export function createAddressesService(db: PrismaClient): AddressesService {
  const repository = createAddressRepository(db);

  // AC de MOVO-119: 403 explícito sobre una dirección ajena, nunca 404 filtrado --
  // mismo criterio que `shipments.service.ts#getShipmentDetail` (MOVO-80): el id es
  // un UUID no adivinable, así que confirmar "existe pero no es tuya" no filtra nada
  // que un atacante pudiera explotar por enumeración.
  async function requireOwnAddress(
    addressId: string,
    callerId: string,
  ): Promise<Address> {
    const address = await repository.findById(addressId);
    if (!address) {
      throw new ApiError(404, "ADDRESS_NOT_FOUND", "Dirección no encontrada.");
    }
    if (address.userId !== callerId) {
      throw new ApiError(
        403,
        "AUTH_FORBIDDEN",
        "No tenés permiso sobre esta dirección.",
      );
    }
    return address;
  }

  return {
    async listMyAddresses(userId: string): Promise<Address[]> {
      return repository.findAllByUserId(userId);
    },

    async createAddress(
      userId: string,
      input: CreateAddressInput,
    ): Promise<Address> {
      return repository.create(userId, input);
    },

    async updateAddress(
      addressId: string,
      callerId: string,
      input: UpdateAddressInput,
    ): Promise<Address> {
      await requireOwnAddress(addressId, callerId);
      return repository.update(addressId, input);
    },

    async deleteAddress(addressId: string, callerId: string): Promise<void> {
      await requireOwnAddress(addressId, callerId);
      await repository.delete(addressId);
    },
  };
}
