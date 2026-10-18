import { ApiError } from "@movo/shared/dist/errors/api-error";
import type { TransactionDetail, TransactionRole } from "@movo/shared/dist/types/transaction";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft, ChevronRight, CreditCard, Package } from "lucide-react-native";
import { ScrollView, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BankLogo } from "../../../../../components/payments/bank-logo";
import { CardBrandLogo } from "../../../../../components/payments/card-brand-logo";
import { MercadoPagoEmblem } from "../../../../../components/payments/mercadopago-logo";
import { TransactionStatusPill } from "../../../../../components/payments/transaction-status-pill";
import { TransactionsError } from "../../../../../components/payments/transactions-states";
import { SkeletonBlock } from "../../../../../components/ui/skeleton-block";
import { useThemeColors } from "../../../../../src/hooks/use-theme-colors";
import { useTransaction } from "../../../../../src/hooks/use-transactions";
import { friendlyErrorMessage } from "../../../../../src/lib/error-messages";
import {
  formatDateTime,
  formatShortDate,
  debtLine,
  formatTransactionAmount,
  movementCopy,
  senderTimeline,
  TRANSACTION_NOT_FOUND_MESSAGE,
  transactionCardMeta,
  transactionCardTitle,
  transactionDisplayCode,
  transactionHeroLabel,
  transactionHeroPill,
} from "../../../../../src/lib/transaction-format";

function SectionLabel({ children }: { children: string }) {
  return <Text className="mb-2 font-sans-semibold text-caption uppercase text-fg-3">{children}</Text>;
}

function Card({ children, testID }: { children: React.ReactNode; testID?: string }) {
  return (
    <View testID={testID} className="overflow-hidden rounded-2xl border border-border bg-bg-sub">
      {children}
    </View>
  );
}

function IconCircle({ children, tint }: { children: React.ReactNode; tint?: string }) {
  return (
    <View
      className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute"
      style={tint ? { backgroundColor: tint } : undefined}
    >
      {children}
    </View>
  );
}

function AmountRow({
  label,
  value,
  muted,
  total,
  testID,
}: {
  label: string;
  value: string;
  muted?: boolean;
  /** Fila final ("Te queda"): resaltada y sin separador inferior. */
  total?: boolean;
  testID?: string;
}) {
  return (
    <View
      testID={testID}
      className={`flex-row items-center gap-3 px-4 py-3.5 ${total ? "bg-lime-200/50 dark:bg-lime-500/10" : "border-b border-border"}`}
    >
      <Text className={`flex-1 text-[14px] ${total ? "font-sans-semibold text-fg" : "font-sans text-fg-2"}`}>{label}</Text>
      <Text
        className={`${total ? "text-[15px]" : "text-[14px]"} font-sans-semibold ${muted ? "text-fg-2" : "text-fg"}`}
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {value}
      </Text>
    </View>
  );
}

function ShipmentLink({ detail, subtitle }: { detail: TransactionDetail; subtitle: string }) {
  const colors = useThemeColors();
  const shipmentId = detail.shipmentId;
  // Un pago de saldo no tiene envío; igual no llega acá (tiene su propio cuerpo).
  if (!shipmentId) return null;
  return (
    <Pressable
      testID="transaction-shipment-link"
      accessibilityRole="button"
      accessibilityLabel={`Ver el envío ${transactionDisplayCode(shipmentId)}`}
      onPress={() => router.push(`/shipments/${shipmentId}`)}
      className="flex-row items-center gap-3 px-4 py-3.5 active:bg-bg-mute"
    >
      <IconCircle>
        <Package size={18} color={colors.fg1} strokeWidth={2} />
      </IconCircle>
      <View className="flex-1">
        <Text className="font-sans-semibold text-[15px] text-fg">{transactionDisplayCode(shipmentId)}</Text>
        <Text className="font-sans text-[12.5px] text-fg-2">{subtitle}</Text>
      </View>
      <ChevronRight size={20} color={colors.fg3} strokeWidth={2} />
    </Pressable>
  );
}

function Hero({ detail, role }: { detail: TransactionDetail; role: TransactionRole }) {
  const breakdown = role === "carrier" && detail.status === "completed" ? detail.breakdown : null;
  const amount = breakdown ? breakdown.netArs : detail.amountArs;
  return (
    <View testID="transaction-hero" className="mx-5 mt-2 gap-1.5 rounded-[20px] bg-ink-950 p-5 dark:border dark:border-border-strong">
      <Text className="font-sans text-[12.5px] text-ink-300">{transactionHeroLabel(detail.status, role, !!breakdown)}</Text>
      <Text
        testID="transaction-hero-amount"
        className={`font-sans-semibold text-[34px] leading-[40px] ${breakdown ? "text-lime-500" : "text-ink-50"}`}
        style={{ fontVariant: ["tabular-nums"] }}
      >
        {formatTransactionAmount(amount)}
      </Text>
      <View className="mt-0.5 flex-row flex-wrap items-center gap-2">
        {/* La pill va sobre fondo oscuro: se fuerza el relleno claro del canvas para el contorno. */}
        <View className={detail.status === "refunded" || detail.status === "disputed" ? "rounded-full bg-paper" : ""}>
          <TransactionStatusPill
            status={detail.status}
            role={role}
            size="md"
            label={transactionHeroPill(detail, role)}
            testID="transaction-hero-pill"
          />
        </View>
        <Text className="font-sans text-[13px] text-ink-300">{formatDateTime(detail.date)}</Text>
      </View>
    </View>
  );
}

/**
 * Método de pago: la misma tarjeta que el usuario ve en Medios. Con banco informado, su logo a la izquierda y la marca
 * a la derecha; sin banco (Amex, o MP no lo informó), el recuadro de marca. El nombre de referencia, si lo tiene,
 * manda; si no, marca y últimos 4.
 */
function PaymentMethodCard({ card }: { card: NonNullable<TransactionDetail["card"]> }) {
  const colors = useThemeColors();
  const meta = transactionCardMeta(card);
  const brand = <CardBrandLogo brand={card.brand} size={26} color={colors.fg1} testID="transaction-card-brand" />;
  return (
    <Card testID="transaction-card">
      <View className="flex-row items-center gap-3 px-4 py-3.5">
        {card.issuerName ? (
          <BankLogo issuerName={card.issuerName} size={40} testID="transaction-card-bank" />
        ) : (
          <IconCircle>{brand ?? <CreditCard size={18} color={colors.fg1} strokeWidth={2} />}</IconCircle>
        )}
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="font-sans-semibold text-[15px] text-fg">{transactionCardTitle(card)}</Text>
          {meta ? <Text numberOfLines={1} className="font-sans text-[12.5px] text-fg-2">{meta}</Text> : null}
        </View>
        {card.issuerName ? brand : null}
      </View>
    </Card>
  );
}

/** Un pago de saldo (MOVO-312): tarjeta y a qué se aplicó; no tiene envío, ni reserva, ni reembolsos. */
function BalancePaymentBody({ detail }: { detail: TransactionDetail }) {
  const colors = useThemeColors();
  return (
    <>
      {detail.card ? (
        <View className="mx-5 mt-[18px]">
          <SectionLabel>Método de pago</SectionLabel>
          <PaymentMethodCard card={detail.card} />
        </View>
      ) : null}
      <View className="mx-5 mt-[18px]">
        <Card testID="transaction-balance-note">
          <Text className="px-4 py-3.5 font-sans text-[14px] leading-[20px] text-fg-2">
            Este pago se aplicó a tu saldo con Movo. Las penalidades que cubre las ves en la pestaña Saldo.
          </Text>
        </Card>
      </View>
    </>
  );
}

function DebtNote({ detail, role }: { detail: TransactionDetail; role: TransactionRole }) {
  const line = debtLine(detail, role);
  if (!line) return null;
  return (
    <View className="mx-5 mt-[18px]">
      <Card testID="transaction-debt-note">
        <Text className="px-4 py-3.5 font-sans-medium text-[14px] leading-[20px] text-fg">{line}</Text>
      </Card>
    </View>
  );
}

function SenderBody({ detail }: { detail: TransactionDetail }) {
  const colors = useThemeColors();
  const timeline = senderTimeline(detail);
  return (
    <>
      {detail.card ? (
        <View className="mx-5 mt-[18px]">
          <SectionLabel>Método de pago</SectionLabel>
          <PaymentMethodCard card={detail.card} />
        </View>
      ) : null}

      <View className="mx-5 mt-[18px]">
        <SectionLabel>Envío</SectionLabel>
        <Card>
          <ShipmentLink detail={detail} subtitle="Ver el envío" />
        </Card>
      </View>

      <View className="mx-5 mt-[18px]">
        <SectionLabel>Movimientos</SectionLabel>
        <Card testID="transaction-movements">
          <View className="px-4 pb-3.5 pt-1.5">
            {timeline.map((event, index) => (
              <TimelineStep
                key={event.key}
                last={index === timeline.length - 1 && detail.movements.length === 0}
                pending={event.pending}
                testID={`transaction-step-${event.key}`}
                title={event.title}
                detail={event.detail}
              />
            ))}
            {detail.movements.map((movement, index) => {
              const copy = movementCopy(movement, detail.amountArs, detail.date);
              return (
                <TimelineStep
                  key={`${movement.kind}-${movement.date}-${index}`}
                  last={index === detail.movements.length - 1}
                  highlight
                  testID={`transaction-movement-${movement.kind}`}
                  title={copy.title}
                  detail={copy.detail}
                  note={copy.linkedNote}
                />
              );
            })}
          </View>
        </Card>
      </View>
    </>
  );
}

function TimelineStep({
  title,
  detail,
  note,
  last,
  highlight,
  pending,
  testID,
}: {
  title: string;
  detail: string;
  note?: string | null;
  last: boolean;
  highlight?: boolean;
  /** Todavía no pasó: punto vacío y texto apagado. */
  pending?: boolean;
  testID?: string;
}) {
  return (
    <View testID={testID} className="relative flex-row gap-3 pt-3">
      {last ? null : <View className="absolute bottom-[-12px] left-[5px] top-7 w-0.5 bg-border-strong" />}
      <View
        className={`mt-1 h-3 w-3 rounded-full ${pending ? "border-2 border-border-strong bg-bg" : highlight ? "border-2 border-fg bg-lime-500" : "bg-fg"}`}
      />
      <View className="flex-1">
        <Text className={`font-sans-semibold text-[14px] ${pending ? "text-fg-3" : "text-fg"}`}>{title}</Text>
        <Text className={`mt-px font-sans text-[12.5px] ${pending ? "text-fg-3" : "text-fg-2"}`}>{detail}</Text>
        {note ? (
          <View className="mt-1.5 rounded-[10px] border border-lime-600/40 bg-lime-200/50 px-2.5 py-2 dark:bg-lime-500/10">
            <Text className="font-sans text-[12.5px] text-ink-950 dark:text-lime-200">{note}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function CarrierBody({ detail }: { detail: TransactionDetail }) {
  // El desglose solo viaja con la liquidación acreditada; mientras tanto no se muestra ningún
  // neto (AC11), ni siquiera con el cobro "Reservado".
  const breakdown = detail.status === "completed" ? detail.breakdown : null;
  return (
    <>
      <View className="mx-5 mt-[18px]">
        <SectionLabel>Cómo se compone</SectionLabel>
        {breakdown ? (
          <Card testID="transaction-breakdown">
            <AmountRow testID="breakdown-gross" label="Pagó el emisor" value={formatTransactionAmount(breakdown.grossArs)} />
            <AmountRow
              testID="breakdown-mp-fee"
              label="Comisión de Mercado Pago"
              value={`− ${formatTransactionAmount(breakdown.mpFeeArs)}`}
              muted
            />
            <AmountRow
              testID="breakdown-commission"
              label="Comisión de Movo"
              value={`− ${formatTransactionAmount(breakdown.commissionArs)}`}
              muted
            />
            {breakdown.debtOffsetArs > 0 ? (
              <AmountRow
                testID="breakdown-debt"
                label="Saldo pendiente descontado"
                value={`− ${formatTransactionAmount(breakdown.debtOffsetArs)}`}
                muted
              />
            ) : null}
            <AmountRow testID="breakdown-net" label="Te queda" value={formatTransactionAmount(breakdown.netArs)} total />
          </Card>
        ) : (
          <Card testID="transaction-breakdown-pending">
            <Text className="px-4 py-3.5 font-sans text-[14px] leading-[20px] text-fg-2">
              {detail.status === "reserved"
                ? "El desglose aparece cuando se acredite el cobro, al entregar el envío."
                : "Este cobro no tiene desglose."}
            </Text>
          </Card>
        )}
      </View>

      <View className="mx-5 mt-[18px]">
        <SectionLabel>Envío</SectionLabel>
        <Card>
          <ShipmentLink
            detail={detail}
            subtitle={detail.capturedAt ? `Acreditado el ${formatShortDate(detail.capturedAt)} · Ver el envío` : "Ver el envío"}
          />
        </Card>
      </View>

      {breakdown ? (
        <View className="mx-5 mt-[18px]">
          <SectionLabel>Cuenta que cobró</SectionLabel>
          <Card>
            <View className="flex-row items-center gap-3 px-4 py-3.5">
              <IconCircle tint="#E8F0FF">
                <MercadoPagoEmblem height={16} />
              </IconCircle>
              <View className="flex-1">
                <Text className="font-sans-semibold text-[15px] text-fg">Mercado Pago</Text>
                <Text className="font-sans text-[12.5px] text-fg-2">Acreditado en tu cuenta vinculada</Text>
              </View>
            </View>
          </Card>
        </View>
      ) : null}
    </>
  );
}

function DetailSkeleton() {
  return (
    <View testID="transaction-detail-loading" accessibilityLabel="Cargando el detalle" className="gap-4 px-5 pt-2">
      <SkeletonBlock className="h-[132px] rounded-[20px]" />
      <SkeletonBlock className="h-14 rounded-2xl" />
      <SkeletonBlock className="h-14 rounded-2xl" />
      <SkeletonBlock className="h-32 rounded-2xl" />
    </View>
  );
}

/**
 * Detalle de una transacción (MOVO-304 AC10-12). `role` viaja como param de ruta desde la
 * tab de origen: el backend filtra y arma el desglose según el rol. Un 404 (transacción ajena
 * o inexistente) se muestra como "No encontramos esta transacción", nunca en blanco.
 */
export default function PaymentTransactionDetailScreen() {
  const colors = useThemeColors();
  const params = useLocalSearchParams<{ id: string; role?: string }>();
  const role: TransactionRole = params.role === "carrier" ? "carrier" : "sender";
  const query = useTransaction(params.id, role);
  const detail = query.data;

  const notFound = query.error instanceof ApiError && query.error.statusCode === 404;
  const title = role === "sender" ? "Detalle del pago" : "Detalle del cobro";

  let body: React.ReactNode;
  if (detail) {
    body = (
      <>
        <Hero detail={detail} role={role} />
        {detail.kind === "balance_payment" ? (
          <BalancePaymentBody detail={detail} />
        ) : (
          <>
            <DebtNote detail={detail} role={role} />
            {role === "sender" ? <SenderBody detail={detail} /> : <CarrierBody detail={detail} />}
          </>
        )}
      </>
    );
  } else if (notFound) {
    body = <TransactionsError testID="transaction-not-found" message={TRANSACTION_NOT_FOUND_MESSAGE} />;
  } else if (query.isError) {
    body = (
      <TransactionsError
        testID="transaction-detail-error"
        message={friendlyErrorMessage(query.error, "No pudimos cargar esta transacción. Intentá de nuevo.")}
        onRetry={() => void query.refetch()}
      />
    );
  } else {
    body = <DetailSkeleton />;
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-2 pt-1.5">
        <Pressable
          testID="transaction-detail-back"
          accessibilityRole="button"
          accessibilityLabel="Volver"
          onPress={() => router.back()}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-[17px] leading-[22px] text-fg">{title}</Text>
      </View>
      <ScrollView contentContainerClassName="pb-8" showsVerticalScrollIndicator={false}>
        {body}
      </ScrollView>
    </SafeAreaView>
  );
}
