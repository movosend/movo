import { ApiError } from "@movo/shared/dist/errors/api-error";
import {
  computeOfferGrossPrice,
  getCommissionConfig,
} from "@movo/shared/dist/config/commission";
import * as Haptics from "expo-haptics";
import { router, useLocalSearchParams } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { Check, ChevronLeft, Delete, ShieldAlert } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { ErrorBanner } from "../../../../components/ui/error-banner";
import { SlideToConfirm } from "../../../../components/ui/slide-to-confirm";
import { TextField } from "../../../../components/ui/text-field";
import type { CreateOfferResponse } from "../../../../src/api/offers-client";
import { useCreateOffer } from "../../../../src/hooks/use-offers";
import { usePublicProfile } from "../../../../src/hooks/use-profile";
import { useShipment } from "../../../../src/hooks/use-shipments";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";
import {
  formatPickupWindowLabel,
  formatPriceArs,
  shortAddressLabel,
} from "../../../../src/lib/shipment-format";

/** MOVO-177: el transportista puede proponer retirar hasta este número de días después
 * de la fecha pedida por el emisor (nunca antes) -- mismo límite que valida el backend
 * (`OFFER_DATE_MAX_FORWARD_OFFSET_DAYS`, `offer-repository.ts`). */
const MAX_ALT_DAY_OFFSET = 3;

const TIME_SLOTS = [
  { start: "08:00", end: "12:00", label: "8:00 – 12:00" },
  { start: "12:00", end: "15:00", label: "12:00 – 15:00" },
  { start: "15:00", end: "19:00", label: "15:00 – 19:00" },
  { start: "19:00", end: "22:00", label: "19:00 – 22:00" },
];

const DAY_CHIP_FORMATTER = new Intl.DateTimeFormat("es-AR", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toDateOnlyString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dayChipLabel(date: Date): string {
  return DAY_CHIP_FORMATTER.format(date);
}

/** Función pura: proyecta un monto de un modo (bruto/neto) al otro, sin depender de
 * ningún estado del componente -- necesaria para poder llamarla desde DENTRO de un
 * `setState` funcional (ver `AmountAnchor` más abajo) sin arriesgar closures
 * obsoletas cuando se dispara una ráfaga de taps del teclado antes del próximo
 * render (ver el bug real que esto reemplaza, MOVO-177). */
function projectAmount(
  amount: number,
  fromMode: "gross" | "net",
  toMode: "gross" | "net",
  rate: number,
): number {
  if (fromMode === toMode) return amount;
  if (fromMode === "net") {
    // neto -> bruto = neto * (1 + tasa), redondeado a centavos.
    return Math.round(amount * (1 + rate) * 100) / 100;
  }
  // bruto -> neto = bruto / (1 + tasa), redondeado a centavos.
  return Math.round((amount / (1 + rate)) * 100) / 100;
}

const KEYPAD_KEYS = [
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "00",
  "0",
  "⌫",
];

function NumericKeypad({
  onDigit,
  onDelete,
}: {
  onDigit: (d: string) => void;
  onDelete: () => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2 px-4 pb-6 pt-1">
      {KEYPAD_KEYS.map((key) => (
        <Pressable
          key={key}
          testID={`create-offer-key-${key === "⌫" ? "del" : key}`}
          onPress={() => (key === "⌫" ? onDelete() : onDigit(key))}
          className="h-12 flex-[1_0_30%] items-center justify-center rounded-md bg-bg-mute"
        >
          {key === "⌫" ? (
            <Delete size={20} color="#0A0A0B" />
          ) : (
            <Text className="font-sans-medium text-[20px] text-fg">{key}</Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

function Chip({
  label,
  selected,
  onPress,
  testID,
  fill,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  testID?: string;
  /** Reparte el ancho disponible entre todos los chips de la fila (flex-1) en vez de
   * ajustarse al contenido (default, usado por los chips de día/franja horaria, que
   * varían en cantidad y largo de label). */
  fill?: boolean;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      className={`rounded-full border px-3.5 py-2.5 ${fill ? "flex-1 items-center" : "flex-none"} ${
        selected ? "border-fg bg-fg" : "border-border-strong bg-bg"
      }`}
    >
      <Text
        className={`font-sans-medium text-[13px] ${selected ? "text-bg" : "text-fg"}`}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Grilla 2x2 de franjas horarias (retiro/entrega) — cuadros, no chips en píldora
 * (`Chip`), para que las 4 franjas se lean como opciones de igual peso en vez de
 * una fila que puede wrappear de forma dispareja según el ancho de pantalla. */
function TimeSlotGrid({
  selectedIndex,
  onSelect,
  testIDPrefix,
}: {
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  testIDPrefix: string;
}) {
  return (
    <View className="flex-row flex-wrap gap-2.5">
      {TIME_SLOTS.map((slot, i) => {
        const selected = selectedIndex === i;
        return (
          <Pressable
            key={slot.label}
            testID={`${testIDPrefix}-${i}`}
            onPress={() => onSelect(i)}
            className={`min-w-[47%] flex-1 rounded-md border-[1.5px] px-3 py-2.5 ${
              selected ? "border-fg bg-fg" : "border-border"
            }`}
          >
            <Text
              className={`font-sans-semibold text-[13px] ${selected ? "text-bg" : "text-fg"}`}
            >
              {slot.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text className="mb-2.5 font-sans-medium text-[11px] uppercase tracking-wide text-fg-3">
      {children}
    </Text>
  );
}

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");
// Diámetro grande a propósito: cubre toda la pantalla sin importar desde qué punto
// arranca el círculo (mismo truco que un "material ripple" a pantalla completa).
const EXPLOSION_DIAMETER = Math.hypot(SCREEN_WIDTH, SCREEN_HEIGHT) * 2.2;
const SUCCESS_OVERLAY_DURATION_MS = 2400;

/** Pantalla de confirmación tras deslizar para ofertar (feedback de diseño,
 * MOVO-177): un círculo lima "explota" desde el centro hasta cubrir toda la
 * pantalla, se muestra la confirmación unos segundos, y se vuelve sola al detalle
 * del envío -- sin botones, la oferta ya quedó mandada y no hay nada más que hacer
 * acá (a diferencia de la pantalla estática anterior con "Ver el envío"/"Editar la
 * oferta"). */
function OfferSuccessOverlay({
  netArs,
  onDone,
}: {
  netArs: number;
  onDone: () => void;
}) {
  const scale = useSharedValue(0);
  const contentOpacity = useSharedValue(0);

  useEffect(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    scale.value = withTiming(1, {
      duration: 480,
      easing: Easing.out(Easing.cubic),
    });
    contentOpacity.value = withDelay(
      200,
      withTiming(1, { duration: 350, easing: Easing.out(Easing.cubic) }),
    );
    const timeout = setTimeout(onDone, SUCCESS_OVERLAY_DURATION_MS);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const circleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  const contentStyle = useAnimatedStyle(() => ({
    opacity: contentOpacity.value,
  }));

  return (
    <View
      testID="create-offer-success-overlay"
      className="absolute inset-0 items-center justify-center bg-bg"
    >
      <Animated.View
        style={[
          {
            position: "absolute",
            width: EXPLOSION_DIAMETER,
            height: EXPLOSION_DIAMETER,
            borderRadius: EXPLOSION_DIAMETER / 2,
            left: (SCREEN_WIDTH - EXPLOSION_DIAMETER) / 2,
            top: (SCREEN_HEIGHT - EXPLOSION_DIAMETER) / 2,
          },
          circleStyle,
        ]}
        className="bg-lime-500"
      />
      <Animated.View style={contentStyle} className="items-center gap-3 px-8">
        <View className="h-16 w-16 items-center justify-center rounded-full bg-ink-950">
          <Check size={32} color="#C6F24A" strokeWidth={3} />
        </View>
        <Text className="text-center font-sans-semibold text-[26px] text-ink-950">
          Oferta enviada
        </Text>
        <Text
          testID="create-offer-success-net"
          className="text-center font-sans text-body text-ink-950/70"
        >
          Te queda {formatPriceArs(netArs)}
        </Text>
      </Animated.View>
    </View>
  );
}

/**
 * Pantalla completa de creación de oferta (MOVO-177, reemplaza el bottom sheet de
 * MOVO-149 -- ofertar es una transacción de plata real entre dos partes, no una
 * confirmación puntual).
 *
 * `amountMode` (feedback de negocio, mismo MOVO-177): el campo de monto es
 * bidireccional -- "gross" (bruto, lo que el emisor paga, default) o "net" (neto, lo
 * que le queda al transportista). El backend (`POST /shipments/:id/offers`) sigue
 * esperando siempre el NETO en `priceOfferedArs` (AC6 de MOVO-143, sin cambios) --
 * en modo "gross" el neto se deriva acá antes de mandarlo, nunca al revés. El monto
 * final que ve el emisor y persiste el backend sigue siendo el que devuelve la
 * respuesta del servidor, no este preview.
 *
 * Desglose neto/comisión de Movo en tiempo real mientras se tipea, usando
 * `computeOfferGrossPrice`/`getCommissionConfig` de `@movo/shared` directamente (mismo
 * criterio que ya usa `movo-svc-shipments` -- una sola fuente de la tasa de comisión,
 * nunca duplicada, aunque la fórmula bruto→neto de "gross" mode es la inversa, resuelta
 * acá porque `@movo/shared` solo expone el sentido neto→bruto).
 *
 * La línea de "Procesamiento del pago" es un ESTIMADO (`MP_TRANSACTION_FEE_RATE`
 * todavía sin confirmar, `movo-svc-payments` no tiene split real) -- se muestra como
 * contexto, nunca restada de "Te queda": ese número sigue siendo exactamente el neto
 * calculado, porque hoy nada se lo descuenta de verdad.
 *
 * La franja de entrega estimada es un campo local todavía sin contrato de backend
 * (ver MOVO-178) -- se completa acá y se refleja en el preview "Lo que va a ver
 * el emisor", pero no viaja en el body de `POST /shipments/:id/offers`: hoy es
 * pura anticipación de lo que se va a mandar cuando el backend lo soporte.
 */
export default function CreateOfferScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const { data: shipment } = useShipment(id);
  const { data: senderProfile } = usePublicProfile(shipment?.senderId);
  const createOffer = useCreateOffer(id);

  // MOVO-177 (feedback de UI): el formulario se partió en 2 pasos -- "precio" era
  // demasiado largo compartiendo pantalla con "cuándo retirás"/"entrega estimada"/
  // mensaje. `formStep` no es parte del `phase` de arriba (form/sending/sent): sigue
  // siendo la misma fase "form", solo cambia qué sección del formulario se ve.
  const [formStep, setFormStep] = useState<1 | 2>(1);
  const scrollRef = useRef<ScrollView>(null);
  // MOVO-177 (fix de negocio): el "ancla" real del monto -- los dígitos tal cual los
  // tipeó el transportista, más en QUÉ modo los tipeó. `amountMode` de abajo es solo
  // el tab seleccionado (UI); nunca hay que confundirlo con "en qué modo está el
  // valor guardado", que es justo la distinción que faltaba antes: cambiar de tab
  // reescribía el monto con una conversión redondeada, así que ir y volver entre
  // tabs (o simplemente mirar el otro tab y volver) iba perdiendo centavos/pesos en
  // cada vuelta. Ahora cambiar de tab SOLO cambia `amountMode` -- el ancla nunca se
  // toca hasta que el usuario realmente edita el monto, así que las dos proyecciones
  // (bruto/neto) siempre se derivan del mismo valor original, nunca de una
  // proyección redondeada anterior.
  //
  // Un solo objeto de estado (no dos `useState` separados para `raw`/`mode`): las
  // ediciones (teclado/chips) actualizan el ancla con la forma FUNCIONAL de
  // `setState`, y necesitan leer `raw` y `mode` juntos y consistentes entre sí en
  // ese mismo callback -- con dos estados separados, una ráfaga de taps sin re-render
  // de por medio (varios `fireEvent.press` seguidos, o varios toques rápidos reales
  // en el teclado dibujado) podía leer un `raw` ya actualizado junto a un `mode`
  // todavía viejo (o viceversa), mezclando dígitos de dos monedas distintas a mitad
  // de camino -- bug real encontrado con un test que tipeaba 4 borrados + 3 dígitos
  // seguidos.
  const [anchor, setAnchor] = useState<{ raw: string; mode: "gross" | "net" }>({
    raw: "",
    mode: "gross",
  });
  // MOVO-177 (feedback de negocio): el campo de monto histórico funcionaba al revés
  // de cómo la empresa lo pensó -- "gross" (bruto, lo que el emisor paga) es el modo
  // real por defecto; "net" (neto, lo que le queda al transportista) es la alternativa
  // que antes era la única opción. `shipment.suggestedPriceArs` YA es el bruto que vio
  // el emisor al crear el envío (mismo precio sugerido de MOVO-82) -- prefillear con
  // ese valor en modo "gross" es una comparación directa sin conversión, a diferencia
  // de antes, que lo trataba como neto y arrastraba el error a toda la pantalla.
  const [amountMode, setAmountMode] = useState<"gross" | "net">("gross");
  const [padOpen, setPadOpen] = useState(false);
  const [dateMode, setDateMode] = useState<"requested" | "other">("requested");
  const [dayOffset, setDayOffset] = useState(0);
  const [pickupSlotIndex, setPickupSlotIndex] = useState<number | null>(null);
  const [deliveryDayOffset, setDeliveryDayOffset] = useState(0);
  const [deliverySlotIndex, setDeliverySlotIndex] = useState<number | null>(
    null,
  );
  const [message, setMessage] = useState("");
  const [phase, setPhase] = useState<"form" | "sending" | "sent">("form");
  const [error, setError] = useState<unknown | null>(null);
  const [createdOffer, setCreatedOffer] = useState<CreateOfferResponse | null>(
    null,
  );

  // Prefill UNA sola vez cuando el envío carga -- guardado con un ref, no
  // dependiente de `amount` en el array de deps. Antes dependía de `amount` para
  // saber "todavía no se prefilleó", pero eso significaba que CADA VEZ que el
  // transportista borraba el campo entero (para escribir un monto propio desde
  // cero) el efecto lo volvía a completar con el sugerido en el próximo render --
  // el campo nunca se podía vaciar de verdad.
  const didPrefillAmount = useRef(false);
  useEffect(() => {
    if (shipment && !didPrefillAmount.current) {
      didPrefillAmount.current = true;
      setAnchor({
        raw: shipment.suggestedPriceArs
          ? String(Math.round(shipment.suggestedPriceArs))
          : "",
        mode: "gross",
      });
    }
  }, [shipment]);

  const commissionRate = getCommissionConfig().movoCommissionRate;
  const rawAmountNumber = parseInt(anchor.raw || "0", 10) || 0;

  // Bidireccional, siempre derivado del ANCLA (`anchor`), nunca del tab actualmente
  // seleccionado (`amountMode`) -- esa es la distinción que evita el arrastre de
  // redondeo al cambiar de tab. En modo "net" el neto es el valor ancla y el bruto se
  // deriva con la misma función pura que usa el backend (`computeOfferGrossPrice`,
  // @movo/shared); en modo "gross" es al revés. En los dos casos
  // `commissionAmountArs` sale de la diferencia entre ambos, nunca de un tercer
  // cálculo que podría desviarse por redondeo.
  const { netArs, grossArs, commissionAmountArs } = useMemo(() => {
    if (anchor.mode === "net") {
      const b = computeOfferGrossPrice(rawAmountNumber, commissionRate);
      return {
        netArs: b.netArs,
        grossArs: b.grossArs,
        commissionAmountArs: b.commissionAmountArs,
      };
    }
    const derivedNetArs = projectAmount(
      rawAmountNumber,
      "gross",
      "net",
      commissionRate,
    );
    return {
      netArs: derivedNetArs,
      grossArs: rawAmountNumber,
      commissionAmountArs:
        Math.round((rawAmountNumber - derivedNetArs) * 100) / 100,
    };
  }, [rawAmountNumber, anchor.mode, commissionRate]);

  // Lo que se muestra en el trigger/teclado para el tab actualmente seleccionado: si
  // es el mismo tab en el que se tipeó por última vez, son los dígitos crudos tal
  // cual (nunca reformateados); si no, es la proyección redondeada derivada del
  // ancla real de arriba -- jamás de una proyección redondeada previa, así que ir y
  // volver de tab no acumula error.
  const displayedAmount =
    amountMode === anchor.mode
      ? rawAmountNumber
      : Math.round(amountMode === "net" ? netArs : grossArs);

  const mpFeeEstimate = useMemo(
    () =>
      Math.round(netArs * getCommissionConfig().mpTransactionFeeRate * 100) /
      100,
    [netArs],
  );
  const commissionPctLabel = `${Math.round(commissionRate * 100)}%`;

  // `shipment.suggestedPriceArs` es BRUTO (el mismo precio sugerido que vio el emisor
  // al crear el envío, MOVO-82) -- para comparar manzanas con manzanas contra lo que
  // el transportista está tipeando, se convierte al mismo modo que `amountMode` antes
  // de comparar.
  const suggestedGross = shipment?.suggestedPriceArs ?? 0;
  const suggestedNet =
    Math.round((suggestedGross / (1 + commissionRate)) * 100) / 100;
  const suggested = amountMode === "gross" ? suggestedGross : suggestedNet;
  const diffPct =
    suggested > 0
      ? Math.round(((displayedAmount - suggested) / suggested) * 100)
      : 0;

  // Cambiar de tab es puramente visual -- nunca toca el ancla, así que las dos
  // proyecciones siempre se recalculan desde el mismo valor original.
  const handleAmountModeChange = (nextMode: "gross" | "net") => {
    setAmountMode(nextMode);
  };

  // Editar (teclado o chips rápidos) SIEMPRE "adopta" el tab actual como el nuevo
  // ancla -- si el usuario estaba mirando una proyección derivada (tab distinto al
  // que se tipeó por última vez) y empieza a tocar el teclado, esa proyección pasa a
  // ser el nuevo valor tipeado de verdad, no una conversión más en la cadena.
  //
  // Forma FUNCIONAL de `setState` en las tres: una ráfaga de taps (varios dígitos o
  // borrados seguidos, sin re-render de por medio) tiene que encadenar sobre el
  // resultado del tap anterior, no sobre el `anchor` ya obsoleto capturado por el
  // closure del render en que se creó el handler -- ese fue exactamente el bug real
  // (los primeros borrados/dígitos de una ráfaga se perdían).
  const commitAmount = (nextRawAmount: string) => {
    setAnchor({ raw: nextRawAmount, mode: amountMode });
  };
  const editAmount = (transform: (base: string) => string) => {
    setAnchor((prev) => {
      const base =
        prev.mode === amountMode
          ? prev.raw
          : String(
              Math.round(
                projectAmount(
                  parseInt(prev.raw || "0", 10) || 0,
                  prev.mode,
                  amountMode,
                  commissionRate,
                ),
              ),
            );
      return { raw: transform(base), mode: amountMode };
    });
  };
  const handleAmountDigit = (d: string) =>
    editAmount((base) => (base + d).replace(/^0+(?=\d)/, "").slice(0, 7));
  const handleAmountDelete = () => editAmount((base) => base.slice(0, -1));
  // "−10%"/"+10%": mismo criterio funcional -- escala el número que se estaría
  // mostrando en este momento (no un `displayedAmount` capturado por closure).
  const scaleAmount = (factor: number) =>
    editAmount((base) =>
      String(Math.round((parseInt(base || "0", 10) || 0) * factor)),
    );

  const dayOptions = useMemo(
    () => Array.from({ length: MAX_ALT_DAY_OFFSET + 1 }, (_, i) => i),
    [],
  );

  const effectivePickupDate = useMemo(() => {
    if (!shipment) return null;
    if (dateMode === "requested") return shipment.pickupDate;
    return toDateOnlyString(
      addDays(parseDateOnly(shipment.pickupDate), dayOffset),
    );
  }, [shipment, dateMode, dayOffset]);

  const pickupSummary =
    dateMode === "requested"
      ? shipment
        ? `${dayChipLabel(parseDateOnly(shipment.pickupDate))} · ${formatPickupWindowLabel(
            shipment.pickupTimeWindowStart,
            shipment.pickupTimeWindowEnd,
          )}`
        : ""
      : pickupSlotIndex !== null && effectivePickupDate
        ? `${dayChipLabel(parseDateOnly(effectivePickupDate))} · ${TIME_SLOTS[pickupSlotIndex].label}`
        : "Elegí un día y una franja";

  const deliverySummary =
    effectivePickupDate && deliverySlotIndex !== null
      ? `${dayChipLabel(addDays(parseDateOnly(effectivePickupDate), deliveryDayOffset))} · ${TIME_SLOTS[deliverySlotIndex].label}`
      : "Todavía sin definir";

  const isKycError =
    error instanceof ApiError && error.code === "CARRIER_NOT_VERIFIED";
  const canContinueToPickup = netArs > 0;
  const canSubmit =
    netArs > 0 &&
    (dateMode === "requested" || pickupSlotIndex !== null) &&
    deliverySlotIndex !== null;

  const handleBack = () => {
    // El botón de volver del header retrocede un paso del formulario antes de
    // abandonar la pantalla -- mismo criterio que el resto de la app (ver
    // `shipments/[id].tsx`): nunca hay dos formas de "volver" con comportamiento
    // distinto (el header y algún botón propio del paso).
    if (formStep === 2) {
      setFormStep(1);
      return;
    }
    if (router.canGoBack()) router.back();
  };

  const handleContinueToPickup = () => {
    if (!canContinueToPickup) return;
    setFormStep(2);
  };

  // Al cambiar de paso, el scroll vuelve arriba -- sin esto, si el transportista
  // había bajado bastante en el paso 1, el paso 2 arrancaría a mitad de camino con
  // contenido nuevo que nunca vio desde el principio.
  useEffect(() => {
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }, [formStep]);

  const handleGoToKyc = () => {
    router.push("/kyc");
  };

  const handleSubmit = async () => {
    if (!canSubmit || !effectivePickupDate) return;
    setError(null);
    setPhase("sending");

    try {
      const data = await createOffer.mutateAsync({
        priceOfferedArs: netArs,
        offeredDate: effectivePickupDate,
        offeredPickupTimeWindowStart:
          dateMode === "other" && pickupSlotIndex !== null
            ? TIME_SLOTS[pickupSlotIndex].start
            : undefined,
        offeredPickupTimeWindowEnd:
          dateMode === "other" && pickupSlotIndex !== null
            ? TIME_SLOTS[pickupSlotIndex].end
            : undefined,
        message: message.trim() || undefined,
      });
      setCreatedOffer(data);
      setPhase("sent");
    } catch (err) {
      setError(err);
      setPhase("form");
    }
  };

  if (!shipment) {
    return (
      <SafeAreaView
        className="flex-1 items-center justify-center bg-bg"
        edges={["top", "bottom"]}
      >
        <ActivityIndicator color={colors.fg2} />
      </SafeAreaView>
    );
  }

  if (phase === "sending") {
    return (
      <SafeAreaView
        className="flex-1 justify-center bg-bg px-7"
        edges={["top", "bottom"]}
      >
        <Text className="font-sans-medium text-[11px] uppercase tracking-wide text-fg-3">
          Publicando oferta
        </Text>
        <Text className="mt-2.5 font-sans-semibold text-[32px] text-fg">
          {formatPriceArs(netArs)}
        </Text>
        <Text className="mt-1 font-sans text-small text-fg-3">
          {shortAddressLabel(shipment.pickupAddress)} →{" "}
          {shortAddressLabel(shipment.deliveryAddress)}
        </Text>
      </SafeAreaView>
    );
  }

  if (phase === "sent" && createdOffer) {
    return (
      <OfferSuccessOverlay
        netArs={createdOffer.priceNetArs}
        onDone={() => router.replace(`/(app)/transport/${id}`)}
      />
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 border-b border-border px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="create-offer-back"
          onPress={handleBack}
          className="h-9 w-9 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <View className="flex-1">
          <Text className="font-sans-semibold text-h3 text-fg">Tu oferta</Text>
          <Text
            className="mt-0.5 font-sans text-[11px] text-fg-3"
            numberOfLines={1}
          >
            {shortAddressLabel(shipment.pickupAddress)} →{" "}
            {shortAddressLabel(shipment.deliveryAddress)}
          </Text>
        </View>
        <Text className="font-sans-medium text-[11px] text-fg-3">
          Paso {formStep} de 2
        </Text>
      </View>
      {/* Indicador de progreso -- 2 segmentos, no una barra continua, porque son
          exactamente 2 pasos fijos (precio / retiro), nunca una cantidad variable. */}
      <View className="flex-row gap-1.5 px-5 pt-2.5">
        <View
          className={`h-1 flex-1 rounded-full ${formStep >= 1 ? "bg-fg" : "bg-bg-mute"}`}
        />
        <View
          className={`h-1 flex-1 rounded-full ${formStep >= 2 ? "bg-fg" : "bg-bg-mute"}`}
        />
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 16 : 0}
      >
        <ScrollView
          ref={scrollRef}
          className="flex-1"
          contentContainerClassName="gap-8 px-5 pb-8 pt-6"
          keyboardShouldPersistTaps="handled"
        >
          {formStep === 1 ? (
            <>
              <View>
                <SectionLabel>Monto de tu oferta</SectionLabel>

                {/* Toggle bruto/neto -- el campo históricamente se pensó como el bruto que
              se le cobra al emisor, no como el neto que se lleva el transportista.
              "Quiero cobrar" (bruto, default) / "Quiero que me paguen" (neto). */}
                <View className="mb-4 flex-row rounded-full border border-border-strong bg-bg-mute p-1">
                  <Pressable
                    testID="create-offer-mode-gross"
                    onPress={() => handleAmountModeChange("gross")}
                    className={`flex-1 items-center rounded-full py-2 ${amountMode === "gross" ? "bg-fg" : ""}`}
                  >
                    <Text
                      className={`font-sans-semibold text-[13px] ${amountMode === "gross" ? "text-bg" : "text-fg-2"}`}
                    >
                      Quiero cobrar
                    </Text>
                  </Pressable>
                  <Pressable
                    testID="create-offer-mode-net"
                    onPress={() => handleAmountModeChange("net")}
                    className={`flex-1 items-center rounded-full py-2 ${amountMode === "net" ? "bg-fg" : ""}`}
                  >
                    <Text
                      className={`font-sans-semibold text-[13px] ${amountMode === "net" ? "text-bg" : "text-fg-2"}`}
                    >
                      Quiero que me paguen
                    </Text>
                  </Pressable>
                </View>
                <Text className="mb-4 font-sans text-caption text-fg-3">
                  {amountMode === "gross"
                    ? "Monto total que le cobrás al emisor por el viaje."
                    : "Lo que te queda a vos después de la comisión de Movo."}
                </Text>

                <Pressable
                  testID="create-offer-amount-trigger"
                  onPress={() => setPadOpen(true)}
                  className={`rounded-[14px] border-[1.5px] px-5 py-5 ${padOpen ? "border-fg bg-bg" : "border-border-strong bg-bg-mute"}`}
                >
                  <View className="flex-row items-end gap-1.5">
                    <Text className="pb-1.5 font-sans-semibold text-[28px] text-fg-3">
                      $
                    </Text>
                    <Text className="font-sans-semibold text-[44px] leading-[46px] text-fg">
                      {displayedAmount > 0
                        ? displayedAmount.toLocaleString("es-AR")
                        : "0"}
                    </Text>
                    <Text className="pb-2 font-sans-medium text-[11px] uppercase tracking-wide text-fg-3">
                      {amountMode === "gross" ? "bruto" : "neto"}
                    </Text>
                  </View>
                  <View className="mt-3 flex-row items-center gap-2">
                    {suggested > 0 ? (
                      <View
                        className={`rounded-full px-2.5 py-1 ${diffPct === 0 ? "bg-bg-mute" : diffPct > 0 ? "bg-lime-100" : "bg-bg-mute"}`}
                      >
                        <Text className="font-sans-semibold text-[12px] text-fg-2">
                          {diffPct === 0
                            ? "= sugerido"
                            : `${diffPct > 0 ? "+" : ""}${diffPct}% vs. sugerido`}
                        </Text>
                      </View>
                    ) : null}
                    <Text className="font-sans text-[12px] text-fg-3">
                      sug. {formatPriceArs(suggested)} (
                      {amountMode === "gross" ? "bruto" : "neto"})
                    </Text>
                  </View>
                </Pressable>

                <View className="mt-4 flex-row gap-2">
                  <Chip
                    fill
                    testID="create-offer-quick-suggested"
                    label="Sugerido"
                    selected={false}
                    onPress={() => commitAmount(String(Math.round(suggested)))}
                  />
                  <Chip
                    fill
                    testID="create-offer-quick-minus10"
                    label="−10%"
                    selected={false}
                    onPress={() => scaleAmount(0.9)}
                  />
                  <Chip
                    fill
                    testID="create-offer-quick-plus10"
                    label="+10%"
                    selected={false}
                    onPress={() => scaleAmount(1.1)}
                  />
                </View>

                {padOpen ? (
                  <View className="mt-4 rounded-[12px] border border-border">
                    <View className="flex-row items-center justify-between px-4 pb-1 pt-3">
                      <Text className="font-sans text-small text-fg-2">
                        Te queda{" "}
                        <Text className="font-sans-semibold text-fg">
                          {formatPriceArs(netArs)}
                        </Text>
                      </Text>
                      <Pressable
                        testID="create-offer-pad-done"
                        onPress={() => setPadOpen(false)}
                        className="rounded-full border border-border-strong px-3 py-1.5"
                      >
                        <Text className="font-sans-semibold text-[13px] text-fg">
                          Listo
                        </Text>
                      </Pressable>
                    </View>
                    <NumericKeypad
                      // El campo puede quedar vacío ("") si se borra todo -- el prefill del
                      // sugerido usa un `useRef` (`didPrefillAmount`) que solo corre una vez,
                      // así que vaciar el campo acá para escribir un monto propio nunca lo
                      // vuelve a completar solo (bug real reportado por el usuario).
                      onDigit={handleAmountDigit}
                      onDelete={handleAmountDelete}
                    />
                  </View>
                ) : null}
              </View>

              <View>
                <SectionLabel>Cómo se reparte</SectionLabel>
                <View className="overflow-hidden rounded-[12px] border border-border">
                  <View className="flex-row items-center justify-between bg-bg-mute px-4 py-4">
                    <Text className="font-sans text-small text-fg-2">
                      El emisor paga el envio
                    </Text>
                    <Text
                      testID="create-offer-gross-preview"
                      className="font-sans-semibold text-body text-fg"
                    >
                      {formatPriceArs(grossArs)}
                    </Text>
                  </View>
                  <View className="h-px bg-border" />
                  <View className="gap-3 px-4 py-4">
                    <View className="flex-row items-center justify-between">
                      <Text className="font-sans text-small text-fg-3">
                        Comisión de Movo ({commissionPctLabel})
                      </Text>
                      <Text className="font-sans text-small text-fg-3">
                        − {formatPriceArs(commissionAmountArs)}
                      </Text>
                    </View>
                    <View className="flex-row items-center justify-between">
                      <Text className="font-sans text-small text-fg-3">
                        Procesamiento del pago (estimado)
                      </Text>
                      <Text className="font-sans text-small text-fg-3">
                        − {formatPriceArs(mpFeeEstimate)}
                      </Text>
                    </View>
                  </View>
                  <View className="flex-row items-center justify-between bg-lime-500 px-4 py-4">
                    <Text className="font-sans-medium text-[11px] uppercase tracking-wide text-ink-950/60">
                      Te queda
                    </Text>
                    <Text
                      testID="create-offer-net-preview"
                      className="font-sans-semibold text-[22px] text-ink-950"
                    >
                      {formatPriceArs(netArs)}
                    </Text>
                  </View>
                </View>
                {/* <Text className="mt-1.5 font-sans text-caption text-fg-3">
            El procesamiento de pago es un estimado (todavía no confirmado con
            MercadoPago) y hoy no se descuenta de nada real — el monto que
            cobrás es exactamente el neto de arriba.
          </Text> */}
              </View>
            </>
          ) : (
            <>
              {isKycError ? (
                <View
                  testID="create-offer-kyc-error"
                  className="rounded-[10px] border border-warning-300 bg-warning-100 p-3.5"
                >
                  <View className="flex-row items-center gap-2">
                    <ShieldAlert size={18} color="#A97714" strokeWidth={2} />
                    <Text className="font-sans-semibold text-small text-warning-700">
                      Verificación requerida
                    </Text>
                  </View>
                  <Text className="mt-1 font-sans text-small text-fg-2">
                    Necesitás verificar tu identidad para poder ofertar por
                    envíos disponibles.
                  </Text>
                  <Pressable
                    testID="create-offer-kyc-cta"
                    onPress={handleGoToKyc}
                    className="mt-2.5 self-start rounded-md bg-fg px-3 py-1.5"
                  >
                    <Text className="font-sans-medium text-[13px] text-bg">
                      Verificar identidad
                    </Text>
                  </Pressable>
                </View>
              ) : error ? (
                <ErrorBanner
                  testID="create-offer-error"
                  message={friendlyErrorMessage(
                    error,
                    "No pudimos enviar tu oferta. Revisá los datos e intentá de nuevo.",
                  )}
                />
              ) : null}

              <View>
                <SectionLabel>Cuándo retirás</SectionLabel>
                <View className="gap-2.5">
                  <Pressable
                    testID="create-offer-date-requested"
                    onPress={() => setDateMode("requested")}
                    className={`flex-row gap-3 rounded-md border-[1.5px] p-3.5 ${dateMode === "requested" ? "border-fg bg-bg-mute" : "border-border"}`}
                  >
                    <View
                      className={`mt-0.5 h-5 w-5 items-center justify-center rounded-full border-[1.5px] ${dateMode === "requested" ? "border-fg bg-fg" : "border-border-strong"}`}
                    >
                      {dateMode === "requested" ? (
                        <View className="h-2 w-2 rounded-full bg-lime-500" />
                      ) : null}
                    </View>
                    <View className="flex-1">
                      <Text className="font-sans-semibold text-small text-fg">
                        Como lo pidió el emisor
                      </Text>
                      <Text className="mt-0.5 font-sans text-small text-fg-2">
                        {dayChipLabel(parseDateOnly(shipment.pickupDate))} ·{" "}
                        {formatPickupWindowLabel(
                          shipment.pickupTimeWindowStart,
                          shipment.pickupTimeWindowEnd,
                        )}
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    testID="create-offer-date-other"
                    onPress={() => setDateMode("other")}
                    className={`flex-row gap-3 rounded-md border-[1.5px] p-3.5 ${dateMode === "other" ? "border-fg bg-bg-mute" : "border-border"}`}
                  >
                    <View
                      className={`mt-0.5 h-5 w-5 items-center justify-center rounded-full border-[1.5px] ${dateMode === "other" ? "border-fg bg-fg" : "border-border-strong"}`}
                    >
                      {dateMode === "other" ? (
                        <View className="h-2 w-2 rounded-full bg-lime-500" />
                      ) : null}
                    </View>
                    <View className="flex-1">
                      <Text className="font-sans-semibold text-small text-fg">
                        Proponer otro día u horario
                      </Text>
                      <Text className="mt-0.5 font-sans text-small text-fg-2">
                        El emisor decide si le sirve
                      </Text>
                    </View>
                  </Pressable>
                </View>

                {dateMode === "other" ? (
                  <View className="mt-3 rounded-md border border-border bg-bg-mute p-3.5">
                    <Text className="mb-2 font-sans-medium text-[12px] text-fg">
                      Día
                    </Text>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerClassName="flex-row gap-2"
                    >
                      {dayOptions.map((offset) => (
                        <Chip
                          key={offset}
                          testID={`create-offer-pickup-day-${offset}`}
                          label={dayChipLabel(
                            addDays(parseDateOnly(shipment.pickupDate), offset),
                          )}
                          selected={dayOffset === offset}
                          onPress={() => setDayOffset(offset)}
                        />
                      ))}
                    </ScrollView>
                    <Text className="mb-2 mt-4 font-sans-medium text-[12px] text-fg">
                      Franja de retiro
                    </Text>
                    <TimeSlotGrid
                      selectedIndex={pickupSlotIndex}
                      onSelect={setPickupSlotIndex}
                      testIDPrefix="create-offer-pickup-slot"
                    />
                  </View>
                ) : null}
              </View>

              <View>
                <SectionLabel>A qué hora entregás (estimado)</SectionLabel>

                <Text className="mb-2 font-sans-medium text-[12px] text-fg">
                  Día de entrega
                </Text>
                <View className="flex-row gap-2">
                  {[0, 1, 2].map((offset) => (
                    <Chip
                      key={offset}
                      testID={`create-offer-delivery-day-${offset}`}
                      label={
                        offset === 0
                          ? "Mismo día"
                          : effectivePickupDate
                            ? dayChipLabel(
                                addDays(
                                  parseDateOnly(effectivePickupDate),
                                  offset,
                                ),
                              )
                            : ""
                      }
                      selected={deliveryDayOffset === offset}
                      onPress={() => setDeliveryDayOffset(offset)}
                    />
                  ))}
                </View>
                <Text className="mb-2 mt-4 font-sans-medium text-[12px] text-fg">
                  Franja de entrega
                </Text>
                <TimeSlotGrid
                  selectedIndex={deliverySlotIndex}
                  onSelect={setDeliverySlotIndex}
                  testIDPrefix="create-offer-delivery-slot"
                />
              </View>

              <View className="rounded-md border border-border-strong p-3.5">
                <Text className="mb-2 font-sans-medium text-[11px] uppercase tracking-wide text-fg-3">
                  Lo que va a ver {senderProfile?.fullName ?? "el emisor"}
                </Text>
                <View className="gap-1.5">
                  <View className="flex-row justify-between gap-3">
                    <Text className="font-sans text-small text-fg-2">
                      Precio
                    </Text>
                    <Text className="font-sans-semibold text-small text-fg">
                      {formatPriceArs(grossArs)}
                    </Text>
                  </View>
                  <View className="flex-row justify-between gap-3">
                    <Text className="font-sans text-small text-fg-2">
                      Retiro
                    </Text>
                    <Text className="text-right font-sans-semibold text-small text-fg">
                      {pickupSummary}
                    </Text>
                  </View>
                  <View className="flex-row justify-between gap-3">
                    <Text className="font-sans text-small text-fg-2">
                      Entrega
                    </Text>
                    <Text className="text-right font-sans-semibold text-small text-fg">
                      {deliverySummary}
                    </Text>
                  </View>
                </View>
                {dateMode === "other" ? (
                  <View className="mt-2.5 rounded-md border border-warning-300 bg-warning-100 px-2.5 py-2">
                    <Text className="font-sans text-[12px] leading-[17px] text-fg">
                      Tu horario no coincide con el pedido. Se lo proponemos
                      como alternativa y puede aceptarlo o no.
                    </Text>
                  </View>
                ) : null}
              </View>

              <View>
                <TextField
                  testID="create-offer-message-input"
                  label="Mensaje para el emisor (recomendado)"
                  placeholder="Ej: Salgo por la mañana, tengo espacio disponible en el baúl."
                  value={message}
                  onChangeText={setMessage}
                  maxLength={500}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  containerClassName="gap-1.5"
                />
              </View>
            </>
          )}
        </ScrollView>

        <View style={{ position: "relative" }}>
          {/* Sombra SOLO en el borde superior -- la barra vive fuera del
              `ScrollView`, sin esto se pierde contra el contenido al hacer scroll
              detrás. Degradado en vez de `shadowOffset`/`elevation`: `elevation` de
              Android proyecta sombra en todo el contorno de la vista (se veía
              también abajo, feedback de diseño), y esto queda arriba de la barra,
              nunca adentro de ella. */}
          <LinearGradient
            pointerEvents="none"
            colors={["transparent", colors.chromeShadow]}
            locations={[0, 1]}
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              top: -24,
              height: 24,
              opacity: 0.5,
            }}
          />
          <View className="border-t border-border bg-bg px-5 pb-6 pt-3.5">
            {formStep === 1 ? (
              <Pressable
                testID="create-offer-continue"
                onPress={handleContinueToPickup}
                disabled={!canContinueToPickup}
                className={`w-full flex-row items-center justify-between rounded-lg px-5 py-3.5 ${canContinueToPickup ? "bg-fg" : "bg-bg-mute"}`}
              >
                <Text
                  className={`font-sans-semibold text-body ${canContinueToPickup ? "text-bg" : "text-fg-3"}`}
                >
                  Continuar
                </Text>
                <Text
                  className={`font-sans-medium text-small ${canContinueToPickup ? "text-lime-500" : "text-fg-3"}`}
                >
                  Te queda {formatPriceArs(netArs)}
                </Text>
              </Pressable>
            ) : (
              <View className="gap-2">
                <Text className="text-center font-sans-medium text-small text-fg-2">
                  Te queda {formatPriceArs(netArs)}
                </Text>
                <SlideToConfirm
                  testID="create-offer-submit"
                  label="Deslizá para confirmar"
                  onConfirm={handleSubmit}
                  disabled={!canSubmit}
                  loading={createOffer.isPending}
                />
              </View>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
