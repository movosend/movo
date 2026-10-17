import type {
  TransactionDetail,
  TransactionListResponse,
  TransactionRole,
  TransactionStatus,
} from "@movo/shared/dist/types/transaction";
import { httpClient } from "./http-client";

export interface ListTransactionsParams {
  role: TransactionRole;
  /** Varios estados se repiten en la query (`status=a&status=b`). */
  status?: readonly TransactionStatus[];
  /** `YYYY-MM-DD`: el backend lo interpreta en hora de Argentina, el mobile no convierte husos. */
  from?: string;
  to?: string;
  cursor?: string;
  limit?: number;
}

/**
 * Historial de pagos y cobros (MOVO-304) contra `GET /payments/transactions[/:id]` de
 * `svc-payments` (MOVO-303). Mismo patrón cliente que `payments-client.ts`.
 */
export const transactionsClient = {
  list(params: ListTransactionsParams): Promise<TransactionListResponse> {
    const { status, ...rest } = params;
    return httpClient.get<TransactionListResponse>("/payments/transactions", {
      ...rest,
      status: status && status.length > 0 ? status : undefined,
    });
  },
  /** 404 si la transacción es ajena o no existe (el mismo, para no revelar que existe). */
  getById(id: string, role: TransactionRole): Promise<TransactionDetail> {
    return httpClient.get<TransactionDetail>(`/payments/transactions/${id}`, { role });
  },
};
