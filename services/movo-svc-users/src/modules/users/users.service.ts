import { AccountStatus, ApiError } from "@movo/shared";
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
      // `deleted` es baja lógica (el registro sigue en la DB) pero se trata como
      // "no existe" hacia afuera: decisión de equipo en review de PR #55 (tmvergara),
      // en línea con el espíritu de protección de datos de MOVO-39 (baja de cuenta),
      // aunque esa US todavía no está implementada. `USER_NOT_FOUND` genérico a
      // propósito, para no distinguir "nunca existió" de "se dio de baja".
      //
      // `banned` sí se sirve como cualquier perfil activo: a diferencia de `deleted`,
      // no es una baja voluntaria — es una sanción reversible (`bannedUntil` puede ser
      // temporal) y el usuario puede tener envíos históricos con una contraparte que
      // necesita seguir viendo con quién trató. Trade-off aceptado: no hay ninguna
      // señal hacia afuera de que la cuenta está baneada (agregar una implicaría un
      // cambio de contrato fuera del alcance de AC3 de MOVO-77).
      if (!user || user.status === AccountStatus.DELETED) {
        throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
      }
      return toPublicProfile(user);
    },
  };
}
