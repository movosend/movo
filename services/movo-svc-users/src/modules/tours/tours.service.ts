import { PrismaClient } from "../../generated/prisma/client";
import { ApiError, TourId, TourOutcome, UserTourRecord } from "@movo/shared";
import { createUserTourRepository, UserTourUserNotFoundError } from "../../repositories/user-tour-repository";

export interface RecordTourInput {
  version: number;
  outcome: TourOutcome;
}

export function createToursService(db: PrismaClient) {
  const repository = createUserTourRepository(db);

  return {
    async recordTour(userId: string, tourId: TourId, input: RecordTourInput): Promise<UserTourRecord> {
      try {
        return await repository.record(userId, tourId, input.version, input.outcome);
      } catch (error) {
        if (error instanceof UserTourUserNotFoundError) {
          throw new ApiError(404, "USER_NOT_FOUND", "Usuario no encontrado.");
        }
        throw error;
      }
    },
  };
}
