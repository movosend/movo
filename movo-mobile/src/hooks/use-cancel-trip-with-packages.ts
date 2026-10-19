import { ApiError } from "@movo/shared/dist/errors/api-error";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { shipmentsClient } from "../api/shipments-client";
import type { TripAcceptedPackage } from "../api/trips-client";
import { shortAddressLabel } from "../lib/shipment-format";
import { penaltyMismatchNotice } from "../lib/cancellation-format";
import { friendlyErrorMessage } from "../lib/error-messages";
import { useCancelTrip } from "./use-trips";
import { invalidateAfterCarrierWithdrawal } from "./use-shipments";

/** Una fila del sheet: un envío aceptado del viaje y lo que cuesta bajarse de él. */
export interface TripCancelRow {
  shipmentId: string;
  senderName: string;
  route: string;
  /** `null` mientras no se cotizó. */
  penaltyArs: number | null;
  /** Ya se bajó de este envío (sirve para reintentar solo lo que falta). */
  done: boolean;
}

export type TripCancelPhase = "idle" | "quoting" | "ready" | "quoteError";

export interface TripCancelResult {
  withdrawnCount: number;
  debtArs: number;
}

const BLOCKING_CODES = new Set(["SHIPMENT_INVALID_TRANSITION", "SHIPMENT_CONCURRENT_MODIFICATION"]);
const FALLBACK_ERROR = "No pudimos cancelar el viaje. Probá de nuevo.";
const PARTIAL_ERROR = "No pudimos terminar de cancelar el viaje. Los envíos que faltan siguen asignados. Probá de nuevo.";
const STALE_ERROR = "Uno de los envíos cambió de estado y el viaje ya no se puede cancelar así. Revisá el detalle.";

function toRow(pkg: TripAcceptedPackage): TripCancelRow {
  return {
    shipmentId: pkg.shipmentId,
    senderName: pkg.senderName,
    route: `${shortAddressLabel(pkg.pickupAddress)} → ${shortAddressLabel(pkg.deliveryAddress)}`,
    penaltyArs: null,
    done: false,
  };
}

/**
 * Cancelar un viaje declarado con paquetes aceptados (MOVO-314). El backend no tiene un endpoint
 * para esto (`POST /trips/:id/cancel` da 409 `TRIP_HAS_ACCEPTED_PACKAGES`), así que se resuelve en
 * el cliente y en secuencia: una baja por envío (`carrier-withdrawal`, con la penalidad que el
 * transportista vio) y, cuando no queda ninguno, `POST /trips/:id/cancel`.
 *
 * No es atómico. Si algo falla a mitad, las filas ya bajadas quedan marcadas (`done`) y el
 * reintento sigue desde donde quedó: la baja es idempotente en el backend y el cancel del viaje
 * recién se intenta cuando todas las filas están hechas.
 */
export function useCancelTripWithPackages(options?: { onStale?: () => void }) {
  const queryClient = useQueryClient();
  const cancelTrip = useCancelTrip();
  const [rows, setRows] = useState<TripCancelRow[]>([]);
  const [phase, setPhase] = useState<TripCancelPhase>("idle");
  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [mismatchNotice, setMismatchNotice] = useState<{ title: string; body: string } | null>(null);

  const rowsRef = useRef<TripCancelRow[]>([]);
  // Una respuesta que llega con el sheet ya cerrado (o reabierto) no pisa el estado nuevo.
  const sessionRef = useRef(0);
  const onStaleRef = useRef(options?.onStale);
  onStaleRef.current = options?.onStale;

  const commitRows = (next: TripCancelRow[]) => {
    rowsRef.current = next;
    setRows(next);
  };

  const patchRow = (shipmentId: string, patch: Partial<TripCancelRow>) =>
    commitRows(rowsRef.current.map((row) => (row.shipmentId === shipmentId ? { ...row, ...patch } : row)));

  /** Cotiza en paralelo las filas que todavía no se bajaron. */
  const quoteAll = useCallback(async (session: number) => {
    setPhase("quoting");
    const pending = rowsRef.current.filter((row) => !row.done);
    const results = await Promise.allSettled(pending.map((row) => shipmentsClient.getCarrierWithdrawalQuote(row.shipmentId)));
    if (session !== sessionRef.current) return;
    let failed = false;
    results.forEach((result, index) => {
      if (result.status === "fulfilled") patchRow(pending[index].shipmentId, { penaltyArs: result.value.penaltyArs });
      else failed = true;
    });
    setPhase(failed ? "quoteError" : "ready");
  }, []);

  /** Al abrir el sheet: arma las filas con los paquetes de ese momento y los cotiza. */
  const open = useCallback(
    (packages: TripAcceptedPackage[]) => {
      const session = ++sessionRef.current;
      setErrorMessage(null);
      setMismatchNotice(null);
      commitRows(packages.map(toRow));
      void quoteAll(session);
    },
    [quoteAll],
  );

  const retryQuotes = useCallback(() => {
    void quoteAll(sessionRef.current);
  }, [quoteAll]);

  /** Al cerrar el sheet: lo que llegue después se descarta. */
  const close = useCallback(() => {
    sessionRef.current += 1;
    setPhase("idle");
    setErrorMessage(null);
    setMismatchNotice(null);
  }, []);

  /** Devuelve el resumen si el viaje quedó cancelado, o `null` si algo falló (el motivo queda en `errorMessage`). */
  const run = useCallback(
    async (tripId: string, stopRecurrence: boolean): Promise<TripCancelResult | null> => {
      if (isRunning || phase !== "ready") return null;
      const session = sessionRef.current;
      setIsRunning(true);
      setErrorMessage(null);
      setMismatchNotice(null);
      try {
        for (const row of rowsRef.current) {
          if (row.done) continue;
          try {
            await shipmentsClient.withdrawCarrier(row.shipmentId, { expectedPenaltyArs: row.penaltyArs ?? 0 });
          } catch (err) {
            if (session !== sessionRef.current) return null;
            if (err instanceof ApiError && err.code === "CANCELLATION_PENALTY_MISMATCH") {
              // Se acercó la hora del retiro: se re-cotiza solo esa fila y se pide confirmar de nuevo.
              const previous = row.penaltyArs ?? 0;
              const quote = await shipmentsClient.getCarrierWithdrawalQuote(row.shipmentId);
              if (session !== sessionRef.current) return null;
              patchRow(row.shipmentId, { penaltyArs: quote.penaltyArs });
              setMismatchNotice(penaltyMismatchNotice(previous, quote.penaltyArs));
              return null;
            }
            if (err instanceof ApiError && BLOCKING_CODES.has(err.code)) {
              setErrorMessage(STALE_ERROR);
              onStaleRef.current?.();
              return null;
            }
            setErrorMessage(rowsRef.current.some((r) => r.done) ? PARTIAL_ERROR : friendlyErrorMessage(err, FALLBACK_ERROR));
            return null;
          }
          if (session === sessionRef.current) patchRow(row.shipmentId, { done: true });
        }
        if (session !== sessionRef.current) return null;
        await cancelTrip.mutateAsync({ id: tripId, stopRecurrence });
        const all = rowsRef.current;
        return { withdrawnCount: all.length, debtArs: all.reduce((sum, row) => sum + (row.penaltyArs ?? 0), 0) };
      } catch (err) {
        if (session === sessionRef.current) setErrorMessage(friendlyErrorMessage(err, PARTIAL_ERROR));
        return null;
      } finally {
        // Haya salido bien o a medias, los envíos bajados dejan de ser del transportista.
        rowsRef.current.filter((row) => row.done).forEach((row) => invalidateAfterCarrierWithdrawal(queryClient, row.shipmentId));
        if (session === sessionRef.current) setIsRunning(false);
      }
    },
    [cancelTrip, isRunning, phase, queryClient],
  );

  const totalDebtArs = rows.reduce((sum, row) => sum + (row.done ? 0 : (row.penaltyArs ?? 0)), 0);

  return { rows, phase, isRunning, errorMessage, mismatchNotice, totalDebtArs, open, retryQuotes, close, run };
}
