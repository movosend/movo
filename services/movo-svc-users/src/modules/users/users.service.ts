import { ApiError } from "@movo/shared";
import { PrismaClient } from "../../generated/prisma/client";
import { createUserRepository } from "../../repositories/user-repository";
import { PrivateProfile, PublicProfile, toPrivateProfile, toPublicProfile } from "../../models/user-profile";

export function createUsersService(db: PrismaClient) {
  const repository = createUserRepository(db);

  return {
    async getUsersCount(): Promise<number> {
      return repository.count();
    },

    async getPrivateProfile(userId: string): Promise<PrivateProfile> {
      const user = await repository.findById(userId);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }
      return toPrivateProfile(user);
    },

    async getPublicProfile(id: string): Promise<PublicProfile> {
      const user = await repository.findById(id);
      if (!user) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }
      return toPublicProfile(user);
    },
  };
}
