import type { ShipmentSettlementResponse } from "@movo/shared/dist/types/settlement";
import type { TransactionListItem } from "@movo/shared/dist/types/transaction";
import { CalendarDays } from "lucide-react-native";
import { Text, View } from "react-native";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  carrierCompensationView,
  formatCancellationDateTime,
  senderCancelledPaymentView,
} from "../../src/lib/cancellation-format";
import { cardTitle } from "../../src/lib/saved-cards";
import { formatSettlementAmount } from "../../src/lib/settlement-format";
import { PriceBreakdownCard, type PriceBreakdownLine } from "../payments/price-breakdown-card";
import { SectionLabel } from "../ui/section-label";

function Pill({ label, tone, testID }: { label: string; tone: "neutral" | "success" | "warning"; testID?: string }) {
  const bg = tone === "success" ? "bg-success-100" : tone === "warning" ? "bg-warning-100" : "bg-bg-mute";
  const text = tone === "success" ? "text-success-700" : tone === "warning" ? "text-warning-700" : "text-fg-2";
  return (
    <View testID={testID} className={`rounded-full px-2.5 py-1 ${bg}`}>
      <Text className={`font-sans-medium text-[12px] ${text}`}>{label}</Text>
    </View>
  );
}

function DateStrip({ text, testID }: { text: string; testID?: string }) {
  const colors = useThemeColors();
  return (
    <View testID={testID} className="flex-row items-start gap-2.5 bg-bg-sub px-3.5 py-3">
      <CalendarDays size={16} color={colors.fg2} strokeWidth={2} style={{ marginTop: 1 }} />
      <Text className="flex-1 font-sans text-[12.5px] leading-[18px] text-fg-2">{text}</Text>
    </View>
  );
}

function Note({ children, testID }: { children: string; testID?: string }) {
  return (
    <Text testID={testID} className="mt-2.5 font-sans text-[12px] leading-[17px] text-fg-3">
      {children}
    </Text>
  );
}

interface SenderCancelledPaymentProps {
  shipment: Pick<ShipmentSummary, "cancellationPenaltyArs" | "cancellationPenaltyStatus" | "lastStatusChangedAt">;
  hold: TransactionListItem | null;
  carrierFirstName?: string | null;
  testID?: string;
}

/**
 * "Tu pago" de un envío cancelado visto por el emisor (MOVO-308), réplica del prototipo
 * "MOVO-308 Emisor cancela": cuánto se reservó, la penalidad (o "Sin cargo"), con qué tarjeta,
 * y cuánto se liberó. No se muestra si el envío nunca llegó a tener reserva.
 */
export function SenderCancelledPayment({ shipment, hold, carrierFirstName, testID }: SenderCancelledPaymentProps) {
  const view = senderCancelledPaymentView(shipment, hold);
  if (!view || !hold) return null;
  const id = (suffix: string) => (testID ? `${testID}-${suffix}` : undefined);

  const lines: PriceBreakdownLine[] = view.lines.map((line) => ({ ...line, testID: id("penalty") }));
  if (hold.card?.last4) {
    lines.push({ label: "Medio de pago", value: cardTitle({ brand: hold.card.brand, last4: hold.card.last4 }), testID: id("card") });
  }
  const cancelledAt = formatCancellationDateTime(shipment.lastStatusChangedAt);
  const dateText = [
    cancelledAt ? `Cancelaste el envío el ${cancelledAt}.` : "Cancelaste el envío.",
    carrierFirstName ? `Le avisamos a ${carrierFirstName}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <View testID={testID}>
      <View className="mb-2.5 flex-row items-center justify-between gap-3">
        <SectionLabel noMargin>Tu pago</SectionLabel>
        <Pill label={view.processing ? "Procesando" : "Cancelado"} tone="neutral" testID={id("pill")} />
      </View>
      <PriceBreakdownCard
        testID={id("card-breakdown")}
        header={{ label: "Reservado en tu tarjeta", value: formatSettlementAmount(view.reservedArs) }}
        lines={lines}
        total={{
          label: view.releasedLabel,
          value: formatSettlementAmount(view.releasedArs),
          variant: "highlight",
          testID: id("released"),
        }}
        footer={<DateStrip text={dateText} testID={id("date")} />}
      />
      {view.note ? <Note testID={id("note")}>{view.note}</Note> : null}
    </View>
  );
}

interface CarrierCancellationCompensationProps {
  settlement: ShipmentSettlementResponse | null | undefined;
  testID?: string;
}

/**
 * Compensación del transportista por la cancelación tardía del emisor (MOVO-308 AC4). Lo que
 * se le muestra es el neto (≈ 11 % del precio, spike MOVO-305), nunca el 25 % bruto: estimado
 * ("Recibís aprox.") hasta que se acredita, real después.
 */
export function CarrierCancellationCompensation({ settlement, testID }: CarrierCancellationCompensationProps) {
  const view = carrierCompensationView(settlement);
  if (!view) return null;
  const id = (suffix: string) => (testID ? `${testID}-${suffix}` : undefined);

  const pill =
    view.kind === "credited" ? (
      <Pill label="Acreditado" tone="success" testID={id("pill")} />
    ) : view.kind === "escalated" ? (
      <Pill label="Demorado" tone="warning" testID={id("pill")} />
    ) : (
      <Pill label="Cobrando" tone="neutral" testID={id("pill")} />
    );

  const card =
    view.kind === "credited" ? (
      <PriceBreakdownCard
        testID={id("card")}
        header={{ label: "Penalidad que pagó el emisor", value: formatSettlementAmount(view.penaltyArs) }}
        lines={[
          { label: "Comisión de Movo", value: `− ${formatSettlementAmount(view.commissionArs)}` },
          { label: "Procesamiento de Mercado Pago", value: `− ${formatSettlementAmount(view.mpFeeArs)}` },
        ]}
        total={{ label: "Te acreditamos", value: formatSettlementAmount(view.netArs), variant: "highlight", testID: id("net") }}
        footer={
          <DateStrip
            testID={id("date")}
            text={
              view.creditedAtLabel
                ? `Acreditado el ${view.creditedAtLabel} en tu cuenta de Mercado Pago.`
                : "Acreditado en tu cuenta de Mercado Pago."
            }
          />
        }
      />
    ) : (
      <PriceBreakdownCard
        testID={id("card")}
        header={{ label: "Penalidad que pagó el emisor", value: formatSettlementAmount(view.penaltyArs) }}
        lines={[
          {
            label: "Comisión de Movo",
            value: view.commissionArs === null ? null : `− ${formatSettlementAmount(view.commissionArs)}`,
          },
          { label: "Procesamiento de Mercado Pago", value: null },
        ]}
        total={
          view.estimatedNetArs === null
            ? { label: "Recibís aprox.", value: "Se confirma al cobrar", variant: "pending", testID: id("net") }
            : {
                label: "Recibís aprox.",
                value: formatSettlementAmount(view.estimatedNetArs),
                variant: "muted",
                testID: id("net"),
              }
        }
      />
    );

  return (
    <View testID={testID}>
      <View className="mb-2.5 flex-row items-center justify-between gap-3">
        <SectionLabel noMargin>Compensación por cancelación</SectionLabel>
        {pill}
      </View>
      {card}
      <Note>
        {view.kind === "escalated"
          ? "No pudimos acreditarte la compensación y la estamos revisando a mano. Te escribimos a la brevedad."
          : "El emisor canceló cerca del retiro y pagó una penalidad. Es lo que te queda después de la comisión de Movo y el procesamiento de Mercado Pago."}
      </Note>
    </View>
  );
}
