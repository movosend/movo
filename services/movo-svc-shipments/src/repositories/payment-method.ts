import { PaymentMethod } from "@movo/shared";

/** Los valores del enum de Prisma (`card`/`cash`) coinciden con los de `PaymentMethod`: un solo mapeo para los tres mappers. */
export function toPaymentMethod(value: string): PaymentMethod {
  return value as PaymentMethod;
}
