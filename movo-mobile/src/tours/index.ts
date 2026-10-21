import type { TourId } from "@movo/shared/dist/config/tours";
import { CARRIER_TOUR } from "./carrier";
import { FIRST_STEPS_TOUR } from "./first-steps";
import type { TourDefinition } from "./types";

export const TOURS: Record<TourId, TourDefinition> = {
  first_steps: FIRST_STEPS_TOUR,
  carrier: CARRIER_TOUR,
};
