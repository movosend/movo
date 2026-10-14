import type { ShipmentSettlementResponse } from "@movo/shared/dist/types/settlement";
import { AlertTriangle, CalendarDays, Check, Clock } from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { usePublicProfile } from "../../src/hooks/use-profile";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  escalatedSettlementMessage,
  formatSettlementAmount,
  formatSettlementDateTime,
  resolvePaymentView,
  type PaymentView,
  type PaymentViewerRole,
} from "../../src/lib/settlement-format";
import { PriceBreakdownCard } from "../payments/price-breakdown-card";
import { SectionLabel } from "../ui/section-label";
import { SkeletonBlock } from "../ui/skeleton-block";

interface SettlementQueryState {
  data: ShipmentSettlementResponse | null | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: () => unknown;
}

interface PaymentBreakdownProps {
  role: PaymentViewerRole;
  shipment: ShipmentSummary;
  /** La consulta la hace la pantalla (`useShipmentSettlement`), que la refresca con el
   * pull-to-refresh y al volver a enfocarse. */
  settlement: SettlementQueryState;
  testID?: string;
}

type PillTone = "success" | "processing" | "warning";

function StatusPill({
  tone,
  label,
  testID,
}: {
  tone: PillTone;
  label: string;
  testID?: string;
}) {
  const colors = useThemeColors();
  const toneClass =
    tone === "success"
      ? "bg-success-100"
      : tone === "warning"
        ? "bg-warning-100"
        : "bg-bg-mute";
  const textClass =
    tone === "success"
      ? "text-success-700"
      : tone === "warning"
        ? "text-warning-700"
        : "text-fg-2";
  return (
    <View
      testID={testID}
      className={`flex-row items-center gap-1.5 rounded-full px-2.5 py-1 ${toneClass}`}
    >
      {tone === "success" ? (
        <Check size={12} color="#16754A" strokeWidth={2.6} />
      ) : null}
      {tone === "processing" ? (
        <ActivityIndicator
          size="small"
          color={colors.fg2}
          style={{ transform: [{ scale: 0.6 }], width: 12, height: 12 }}
        />
      ) : null}
      <Text className={`font-sans-medium text-[12px] ${textClass}`}>
        {label}
      </Text>
    </View>
  );
}

function ProcessingStatus({ body }: { body: string }) {
  const colors = useThemeColors();
  return (
    <View className="flex-row items-start gap-3 px-3.5 pb-1 pt-3.5">
      <View className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute">
        <Clock size={16} color={colors.fg2} strokeWidth={2} />
      </View>
      <View className="flex-1">
        <Text className="font-sans-semibold text-[14px] leading-5 text-fg">
          Estamos cobrando el envío
        </Text>
        <Text className="mt-0.5 font-sans text-[12.5px] leading-[18px] text-fg-2">
          {body}
        </Text>
      </View>
    </View>
  );
}

function DateStrip({ text, testID }: { text: string; testID?: string }) {
  const colors = useThemeColors();
  return (
    <View
      testID={testID}
      className="flex-row items-start gap-2.5 bg-bg-sub px-3.5 py-3"
    >
      <CalendarDays
        size={16}
        color={colors.fg2}
        strokeWidth={2}
        style={{ marginTop: 1 }}
      />
      <Text className="flex-1 font-sans text-[12.5px] leading-[18px] text-fg-2">
        {text}
      </Text>
    </View>
  );
}

function Note({ children }: { children: string }) {
  return (
    <Text className="mt-2.5 font-sans text-[12px] leading-[17px] text-fg-3">
      {children}
    </Text>
  );
}

function amountOrDash(value: number | null): string {
  return value === null ? "—" : formatSettlementAmount(value);
}

/**
 * Detalle del pago de un envío entregado (MOVO-214), referencia visual: canvas "MOVO-214 ·
 * Detalle del pago" de Claude Design. El transportista ve el desglose de su cobro con el
 * mismo formato que vio al ofertar (`PriceBreakdownCard`, MOVO-186); el emisor, solo el total
 * y la fecha. El receptor no llega acá (lo decide la pantalla, y el backend le responde 403).
 */
export function PaymentBreakdown({
  role,
  shipment,
  settlement,
  testID,
}: PaymentBreakdownProps) {
  const colors = useThemeColors();
  const { data: carrierProfile } = usePublicProfile(
    role === "sender" ? (shipment.carrierId ?? undefined) : undefined,
  );
  const label = role === "carrier" ? "Tu cobro" : "Tu pago";

  if (settlement.isLoading) {
    return (
      <View testID={testID ? `${testID}-loading` : undefined}>
        <SectionLabel>{label}</SectionLabel>
        <SkeletonBlock className="h-40 rounded-md" />
      </View>
    );
  }

  if (settlement.isError && settlement.data === undefined) {
    return (
      <View testID={testID ? `${testID}-error` : undefined}>
        <SectionLabel>{label}</SectionLabel>
        <View className="flex-row items-center justify-between gap-3 rounded-md border border-border px-3.5 py-3.5">
          <Text className="flex-1 font-sans text-small text-fg-2">
            No pudimos cargar el detalle del pago.
          </Text>
          <Pressable
            testID={testID ? `${testID}-retry` : undefined}
            onPress={() => void settlement.refetch()}
            accessibilityRole="button"
            className="rounded-lg bg-bg-mute px-3 py-1.5"
          >
            <Text className="font-sans-medium text-small text-fg">
              Reintentar
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const view = resolvePaymentView(
    role,
    settlement.data ?? null,
    shipment.agreedPriceArs,
  );
  const deliveredAtLabel = shipment.deliveredAt
    ? formatSettlementDateTime(shipment.deliveredAt)
    : null;
  const senderHeaderValue = (
    <View className="flex-row items-center gap-1.5">
      <Check size={14} color={colors.fg1} strokeWidth={2.4} />
      <Text className="font-sans-semibold text-small text-fg">
        {deliveredAtLabel ?? "Entregado"}
      </Text>
    </View>
  );
  const senderLines = [
    { label: "Transportista", value: carrierProfile?.fullName ?? null },
    { label: "Medio de pago", value: "Mercado Pago" },
  ];

  const { pill, card, note } = renderView(view, {
    testID,
    senderHeaderValue,
    senderLines,
  });

  return (
    <View testID={testID}>
      <View className="mb-2.5 flex-row items-center justify-between gap-3">
        <SectionLabel noMargin>{label}</SectionLabel>
        {pill}
      </View>
      {card}
      {note}
    </View>
  );
}

function renderView(
  view: PaymentView,
  ctx: {
    testID?: string;
    senderHeaderValue: ReactNode;
    senderLines: { label: string; value: string | null }[];
  },
): { pill: ReactNode; card: ReactNode; note: ReactNode } {
  const id = (suffix: string) =>
    ctx.testID ? `${ctx.testID}-${suffix}` : undefined;

  switch (view.kind) {
    case "carrier_credited": {
      const creditedAt = view.creditedAt
        ? formatSettlementDateTime(view.creditedAt)
        : null;
      return {
        pill: (
          <StatusPill tone="success" label="Acreditado" testID={id("pill")} />
        ),
        card: (
          <PriceBreakdownCard
            testID={id("card")}
            header={{
              label: "El emisor pagó",
              value: formatSettlementAmount(view.grossArs),
            }}
            lines={[
              {
                label: "Comisión de Movo",
                value: `− ${formatSettlementAmount(view.commissionArs)}`,
              },
              {
                label: "Procesamiento de Mercado Pago",
                value: `− ${formatSettlementAmount(view.mpFeeArs)}`,
              },
            ]}
            total={{
              label: "Te acreditamos",
              value: formatSettlementAmount(view.netArs),
              variant: "highlight",
              testID: id("net"),
            }}
            footer={
              <DateStrip
                testID={id("date")}
                text={
                  creditedAt
                    ? `Acreditado el ${creditedAt} en tu cuenta de Mercado Pago.`
                    : "Acreditado en tu cuenta de Mercado Pago."
                }
              />
            }
          />
        ),
        note: (
          <Note>
            El procesamiento es lo que cobró Mercado Pago por esta operación.
            Puede diferir del estimado que viste al ofertar.
          </Note>
        ),
      };
    }
    case "carrier_processing":
      return {
        pill: (
          <StatusPill tone="processing" label="Cobrando" testID={id("pill")} />
        ),
        card: (
          <PriceBreakdownCard
            testID={id("card")}
            header={{
              label: "Monto del envío",
              value: amountOrDash(view.amountArs),
            }}
            status={
              <ProcessingStatus body="Cuando Mercado Pago confirme el cobro vas a ver acá cuánto te acreditamos. Te avisamos con una notificación." />
            }
            lines={[
              { label: "Comisión de Movo", value: null },
              { label: "Procesamiento de Mercado Pago", value: null },
            ]}
            total={{
              label: "Te acreditamos",
              value: "Se confirma al cobrar",
              variant: "pending",
              testID: id("net"),
            }}
          />
        ),
        note: null,
      };
    case "carrier_escalated":
      return {
        pill: (
          <StatusPill tone="warning" label="Demorado" testID={id("pill")} />
        ),
        card: (
          <PriceBreakdownCard
            testID={id("card")}
            banner={
              <View
                testID={id("escalated")}
                className="flex-row items-start gap-3 border-b border-warning-200 bg-warning-100 px-3.5 py-3.5"
              >
                <View className="h-8 w-8 items-center justify-center rounded-full bg-warning-200">
                  <AlertTriangle size={16} color="#A97714" strokeWidth={2} />
                </View>
                <View className="flex-1">
                  <Text className="font-sans-semibold text-[14px] leading-5 text-ink-950">
                    Tu cobro está demorado
                  </Text>
                  <Text className="mt-0.5 font-sans text-[12.5px] leading-[18px] text-ink-600">
                    {escalatedSettlementMessage()}
                  </Text>
                </View>
              </View>
            }
            header={{
              label: "Monto del envío",
              value: amountOrDash(view.amountArs),
            }}
            lines={[
              { label: "Comisión de Movo", value: null },
              { label: "Procesamiento de Mercado Pago", value: null },
            ]}
            total={{
              label: "Te acreditamos",
              value: "En revisión",
              variant: "pending",
              testID: id("net"),
            }}
          />
        ),
        note: (
          <Note>
            La entrega quedó confirmada y registrada. La demora es del cobro, no
            de tu entrega.
          </Note>
        ),
      };
    case "sender_paid": {
      const paidAt = view.paidAt ? formatSettlementDateTime(view.paidAt) : null;
      return {
        pill: <StatusPill tone="success" label="Cobrado" testID={id("pill")} />,
        card: (
          <PriceBreakdownCard
            testID={id("card")}
            header={{ label: "Envío entregado", value: ctx.senderHeaderValue }}
            lines={ctx.senderLines}
            total={{
              label: "Pagaste",
              value: formatSettlementAmount(view.amountArs),
              variant: "highlight",
              testID: id("total"),
            }}
            footer={
              <DateStrip
                testID={id("date")}
                text={
                  paidAt
                    ? `Mercado Pago lo cobró el ${paidAt}, cuando se confirmó la entrega.`
                    : "Mercado Pago lo cobró cuando se confirmó la entrega."
                }
              />
            }
          />
        ),
        note: null,
      };
    }
    case "sender_processing":
      return {
        pill: (
          <StatusPill
            tone="processing"
            label="Procesando"
            testID={id("pill")}
          />
        ),
        card: (
          <PriceBreakdownCard
            testID={id("card")}
            header={{ label: "Envío entregado", value: ctx.senderHeaderValue }}
            status={
              <ProcessingStatus body="Usamos el monto que reservamos en tu tarjeta. Te avisamos cuando Mercado Pago lo confirme." />
            }
            lines={ctx.senderLines}
            total={
              view.amountArs === null
                ? {
                    label: "Reservado",
                    value: "—",
                    variant: "pending",
                    testID: id("total"),
                  }
                : {
                    label: "Reservado",
                    value: formatSettlementAmount(view.amountArs),
                    variant: "muted",
                    testID: id("total"),
                  }
            }
          />
        ),
        note: null,
      };
  }
}
