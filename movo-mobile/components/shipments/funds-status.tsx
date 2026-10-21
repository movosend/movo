import * as Haptics from "expo-haptics";
import { router, type Href } from "expo-router";
import {
  AlertTriangle,
  Check,
  Clock,
  CreditCard,
  Info,
  LockOpen,
  PauseCircle,
  RotateCcw,
} from "lucide-react-native";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import {
  failureReasonCopy,
  formatFundingCard,
  formatFundingDay,
  formatFundingDayWithArticle,
  formatFundingDeadline,
  fundsStatusVariant,
  lapseReasonCopy,
} from "../../src/lib/funds-status-format";
import { formatPickupDayLabel, formatPriceArs } from "../../src/lib/shipment-format";
import { GridPattern } from "../ui/grid-pattern";

export interface FundsStatusProps {
  shipment: ShipmentSummary;
  /** Nombre de pila del transportista, para el copy del emisor. Sin él se usa "el transportista". */
  carrierFirstName?: string;
  testID?: string;
}

const INK = "#0A0A0B";

/**
 * MOVO-211: estado de la reserva de fondos, arriba de todo en la pestaña Detalle. Sigue el
 * prototipo de Claude Design ("MOVO-211 Estado de la reserva"). La fase la decide el backend
 * (`shipment.funding`); este componente no calcula plazos ni estados. Sin `funding` no
 * renderiza nada (receptor, terceros, o un envío sin transportista todavía).
 *
 * AC7: ninguna variante afirma un débito antes de `captured`. Donde el emisor podría dudar
 * (pendiente, rechazado, vuelto a publicar) se dice explícitamente que no se retuvo ni se
 * cobró nada.
 */
export function FundsStatus({ shipment, carrierFirstName, testID }: FundsStatusProps) {
  const colors = useThemeColors();
  const funding = shipment.funding;
  const variant = fundsStatusVariant(funding, shipment.status);
  if (!funding || !variant) return null;

  const id = testID ?? "funds-status";
  const name = carrierFirstName ?? "el transportista";
  const Name = carrierFirstName ?? "El transportista";
  // Pantalla de pago real (MOVO-269). `resumed` = retoma un pago que quedó a medias (AC7 de ese ticket).
  const goToPayment = (resumed = false) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push(`/(app)/shipments/${shipment.id}/pay${resumed ? "?resumed=1" : ""}` as Href);
  };

  if (funding.viewer === "carrier") {
    if (funding.phase === "held") {
      return (
        <Card testID={`${id}-carrier-held`}>
          <Eyebrow dot>Fondos reservados</Eyebrow>
          <Title>El pago del envío ya está reservado</Title>
          <Body>Lo cobrás cuando entregues el paquete.</Body>
        </Card>
      );
    }
    return (
      <Card testID={`${id}-carrier-pending`}>
        <Row icon={<IconCircle tone="mute"><Clock size={18} color={colors.fg2} strokeWidth={2} /></IconCircle>}>
          <Title>Pago del emisor pendiente</Title>
          <Body>
            Tiene hasta <Strong>{formatFundingDeadline(funding.payUntil)}</Strong> para reservarlo. Si no lo
            hace, el envío se libera y te avisamos.
          </Body>
        </Row>
      </Card>
    );
  }

  if (funding.viewer === "former_carrier") {
    return (
      <Card strong testID={`${id}-carrier-lapsed`}>
        <Row icon={<IconCircle tone="warning"><AlertTriangle size={18} color="#6B4A0C" strokeWidth={2} /></IconCircle>}>
          <Title>Este envío se liberó</Title>
          <Body>
            {lapseReasonCopy(funding.reason, "carrier")} El lugar que tenías en tu viaje para este paquete quedó
            libre.
          </Body>
        </Row>
        <OutlineButton
          testID={`${id}-find-shipments`}
          label="Buscar otros envíos"
          onPress={() => router.replace("/(app)/(tabs)/transport")}
        />
      </Card>
    );
  }

  switch (funding.phase) {
    case "awaiting_window":
      return (
        <Card testID={`${id}-awaiting-window`}>
          <Row icon={<IconCircle tone="lime"><Check size={18} color={INK} strokeWidth={2.2} /></IconCircle>}>
            <Title>Todo en orden. {Name} lleva tu paquete.</Title>
            <Body>
              Vas a poder confirmar el pago a partir de{" "}
              <Strong>{formatFundingDayWithArticle(funding.windowOpensAt)}</Strong> y te avisamos ese día. Por ahora no tenés
              que hacer nada: no se retuvo ni se cobró ningún monto.
            </Body>
          </Row>
          <FundingTimeline
            testID={`${id}-timeline`}
            steps={[
              { when: "Hoy", what: carrierFirstName ? `${carrierFirstName} confirmado` : "Transportista confirmado", done: true },
              { when: formatFundingDay(funding.windowOpensAt), what: "Confirmás el pago" },
              { when: formatPickupDayLabel(shipment.pickupDate), what: "Retiro" },
            ]}
          />
        </Card>
      );

    case "payment_due": {
      const amount = formatPriceArs(funding.amountArs);
      const deadline = formatFundingDeadline(funding.payUntil);

      if (funding.lastAttempt === "in_process") {
        return (
          <Card testID={`${id}-processing`}>
            <Row icon={<IconCircle tone="mute"><ActivityIndicator size="small" color={colors.fg1} /></IconCircle>}>
              <Title>Estamos procesando tu pago</Title>
              <Body>
                Mercado Pago está validando la tarjeta para reservar {amount}. Suele tardar unos segundos. Todavía no
                se retuvo nada.
              </Body>
              {funding.card ? <CardLabel testID={`${id}-card`}>{formatFundingCard(funding.card)}</CardLabel> : null}
            </Row>
          </Card>
        );
      }

      if (funding.lastAttempt === "rejected") {
        const copy = failureReasonCopy(funding.failureReason);
        return (
          <Card strong testID={`${id}-rejected`}>
            <Row icon={<IconCircle tone="danger"><CreditCard size={18} color="#972327" strokeWidth={2} /></IconCircle>}>
              <Title testID={`${id}-rejected-title`}>{copy.title}</Title>
              <Body>{copy.body}</Body>
              <Text className="mt-2 font-sans-medium text-small text-fg">No se retuvo ni se cobró nada.</Text>
            </Row>
            <View className="flex-row items-center justify-between gap-2 rounded-md bg-bg-mute px-3 py-2.5">
              {funding.card ? (
                <Text testID={`${id}-card`} className="font-mono text-[12px] text-fg-2">
                  {formatFundingCard(funding.card)}
                </Text>
              ) : (
                <View />
              )}
              <Text className="font-sans text-[12px] text-fg-2">
                Hasta <Text className="font-sans-semibold text-fg">{deadline}</Text>
              </Text>
            </View>
            <DarkButton testID={`${id}-cta`} label="Reintentar con otra tarjeta" onPress={() => goToPayment()} />
          </Card>
        );
      }

      if (funding.route === "near" && funding.lastAttempt === "none") {
        return (
          <Card testID={`${id}-unfinished`}>
            <Row icon={<IconCircle tone="mute"><PauseCircle size={18} color={colors.fg2} strokeWidth={2} /></IconCircle>}>
              <Title>Tu pago quedó sin terminar</Title>
              <Body>
                Empezaste a confirmar el pago pero no lo completaste. No se retuvo nada. Retomalo antes de{" "}
                <Strong>{deadline}</Strong>.
              </Body>
            </Row>
            <DarkButton testID={`${id}-cta`} label="Retomar pago" onPress={() => goToPayment(true)} />
          </Card>
        );
      }

      return (
        <View testID={`${id}-confirm`} className="overflow-hidden rounded-md border border-border">
          <View className="relative overflow-hidden bg-lime-200 p-4">
            <GridPattern />
            <View className="flex-row items-center gap-2">
              <View className="h-2 w-2 rounded-full bg-ink-950" />
              <Text className="font-sans-medium text-caption uppercase tracking-wider text-ink-700">
                {funding.holdLost ? "Volvé a confirmar tu pago" : "Confirmá tu pago"}
              </Text>
            </View>
            <Text className="mt-2 font-sans text-small text-ink-700">Precio del envío</Text>
            <Text testID={`${id}-amount`} className="mt-2 font-sans-semibold text-[32px] leading-9 text-ink-950">
              {amount}
            </Text>
            <Text className="mt-0.5 font-sans text-small text-ink-700">
              Tenés tiempo hasta <Text className="font-sans-semibold text-ink-950">{deadline}</Text>
            </Text>
          </View>
          <View className="gap-3.5 bg-bg px-4 pb-4 pt-3.5">
            <Body>
              {funding.holdLost
                ? `La reserva anterior venció en Mercado Pago y se liberó sin cobrarte nada. Confirmala de nuevo para que ${name} pueda retirar el paquete.`
                : `El total queda reservado en tu tarjeta y se cobra recién cuando ${name} entregue el paquete. Si no lo confirmás antes de esa fecha, el envío vuelve a publicarse.`}
              {" "}El total a reservar, incluida cualquier deuda pendiente, se muestra antes de confirmar el pago.
            </Body>
            <DarkButton testID={`${id}-cta`} label="Confirmar pago" onPress={() => goToPayment()} limeDot />
          </View>
        </View>
      );
    }

    case "held": {
      const amount = formatPriceArs(funding.amountArs);
      const eyebrow =
        variant === "held_in_transit" ? "En camino" : variant === "held_delivered" ? "Entregado" : "Fondos reservados";
      const body =
        variant === "held_in_transit"
          ? `${Name} ya retiró el paquete. Se cobra cuando lo entregue en destino.`
          : variant === "held_delivered"
            ? `${Name} entregó el paquete. Estamos procesando el cobro de la reserva.`
            : `Se cobra recién cuando ${name} entregue el paquete, no antes.`;
      return (
        <Card testID={`${id}-held`}>
          <View className="flex-row items-center justify-between gap-2">
            <Eyebrow dot testID={`${id}-held-eyebrow`}>{eyebrow}</Eyebrow>
            {funding.card ? (
              <Text testID={`${id}-card`} className="font-mono text-[12px] text-fg-3">
                {formatFundingCard(funding.card)}
              </Text>
            ) : null}
          </View>
          <View>
            <Title>Reservaste {amount}</Title>
            <Body>{body}</Body>
          </View>
          <View className="flex-row items-start gap-2.5 rounded-md bg-bg-mute px-3 py-2.5">
            <Info size={16} color={colors.fg2} strokeWidth={2} style={{ marginTop: 1 }} />
            <Text className="flex-1 font-sans text-[12px] leading-[17px] text-fg-2">
              En tu resumen vas a ver {amount} retenidos. Es una reserva, no un cobro: si el envío se cancela antes de
              la entrega, se libera.
            </Text>
          </View>
        </Card>
      );
    }

    case "captured":
      return (
        <Card testID={`${id}-captured`}>
          <Row icon={<IconCircle tone="success"><Check size={18} color="#16754A" strokeWidth={2.2} /></IconCircle>}>
            <View className="flex-row items-baseline justify-between gap-2">
              <Title>Pago cobrado</Title>
              <Text className="font-sans-semibold text-[17px] text-fg">{formatPriceArs(funding.amountArs)}</Text>
            </View>
            <Body>
              {Name} entregó el paquete el {formatFundingDay(funding.at)} y ahí se cobró la reserva.
            </Body>
          </Row>
        </Card>
      );

    case "released":
      return (
        <Card testID={`${id}-released`}>
          <Row icon={<IconCircle tone="mute"><LockOpen size={18} color={colors.fg2} strokeWidth={2} /></IconCircle>}>
            <Title>Se liberó la reserva</Title>
            <Body>
              El envío se canceló, así que los {formatPriceArs(funding.amountArs)} retenidos quedan libres.
              {funding.penaltyStatus === "debt" && funding.penaltyArs ? (
                <> La penalidad de {formatPriceArs(funding.penaltyArs)} quedó pendiente en tu cuenta corriente.</>
              ) : funding.penaltyStatus === "pending" && funding.penaltyArs ? (
                <> La penalidad de {formatPriceArs(funding.penaltyArs)} todavía se está procesando.</>
              ) : funding.penaltyStatus === "captured" && funding.penaltyArs ? (
                <> Se cobró la penalidad de {formatPriceArs(funding.penaltyArs)}.</>
              ) : (
                <> No se cobró nada.</>
              )} Según tu banco, puede tardar unos días en desaparecer del resumen.
            </Body>
          </Row>
        </Card>
      );

    case "lapsed":
      return (
        <Card strong testID={`${id}-lapsed`}>
          <Row icon={<IconCircle tone="warning"><RotateCcw size={18} color="#6B4A0C" strokeWidth={2} /></IconCircle>}>
            <Title>Tu envío volvió a publicarse</Title>
            <Body>{lapseReasonCopy(funding.reason, "sender")}</Body>
            <Text className="mt-2 font-sans-medium text-small text-fg">No se retuvo ni se cobró nada.</Text>
          </Row>
          {/* Sin botón a las ofertas: la bandeja de ofertas va justo debajo de esta card y es
              el único acceso, así no hay dos botones que llevan al mismo lugar. */}
        </Card>
      );
  }
}

function Card({ children, strong, testID }: { children: ReactNode; strong?: boolean; testID?: string }) {
  return (
    <View
      testID={testID}
      className={`gap-3.5 rounded-md border bg-bg p-4 ${strong ? "border-fg/25" : "border-border"}`}
    >
      {children}
    </View>
  );
}

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <View className="flex-row items-start gap-3">
      {icon}
      <View className="min-w-0 flex-1">{children}</View>
    </View>
  );
}

const ICON_TONE: Record<"lime" | "mute" | "danger" | "warning" | "success", string> = {
  lime: "bg-lime-200",
  mute: "bg-bg-mute",
  danger: "bg-danger-100",
  warning: "bg-warning-200",
  success: "bg-success-100",
};

function IconCircle({ tone, children }: { tone: keyof typeof ICON_TONE; children: ReactNode }) {
  return (
    <View className={`h-9 w-9 items-center justify-center rounded-full ${ICON_TONE[tone]}`}>{children}</View>
  );
}

function Title({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text testID={testID} className="font-sans-semibold text-[15px] leading-5 text-fg">
      {children}
    </Text>
  );
}

function Body({ children }: { children: ReactNode }) {
  return <Text className="mt-1 font-sans text-small leading-[19px] text-fg-2">{children}</Text>;
}

function Strong({ children }: { children: ReactNode }) {
  return <Text className="font-sans-semibold text-fg">{children}</Text>;
}

function CardLabel({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Text testID={testID} className="mt-2 font-mono text-[12px] text-fg-3">
      {children}
    </Text>
  );
}

function Eyebrow({ children, dot, testID }: { children: ReactNode; dot?: boolean; testID?: string }) {
  return (
    <View testID={testID} className="flex-row items-center gap-2">
      {dot ? <View className="h-2 w-2 rounded-full bg-lime-500" /> : null}
      <Text className="font-sans-medium text-caption uppercase tracking-wider text-fg-2">{children}</Text>
    </View>
  );
}

function DarkButton({
  label,
  onPress,
  limeDot,
  testID,
}: {
  label: string;
  onPress: () => void;
  limeDot?: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      className="flex-row items-center justify-center gap-2.5 rounded-lg bg-fg py-3.5 active:opacity-85"
    >
      {limeDot ? <View className="h-1.5 w-1.5 rounded-full bg-lime-500" /> : null}
      <Text className="font-sans-semibold text-body text-bg">{label}</Text>
    </Pressable>
  );
}

function OutlineButton({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      className="items-center justify-center rounded-lg border border-fg/25 bg-bg py-3 active:bg-bg-mute"
    >
      <Text className="font-sans-semibold text-body text-fg">{label}</Text>
    </Pressable>
  );
}

export function FundingTimeline({
  steps,
  testID,
}: {
  steps: { when: string; what: string; done?: boolean }[];
  testID?: string;
}) {
  return (
    <View testID={testID} className="flex-row gap-1.5">
      {steps.map((step) => (
        <View key={step.what} className="flex-1 gap-1.5">
          <View className={`h-1 rounded-full ${step.done ? "bg-lime-500" : "bg-bg-mute"}`} />
          <Text className="font-mono text-[11px] text-fg-3">{step.when}</Text>
          <Text className="font-sans-medium text-[12px] text-fg">{step.what}</Text>
        </View>
      ))}
    </View>
  );
}
