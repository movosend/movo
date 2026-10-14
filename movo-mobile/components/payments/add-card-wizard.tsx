import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { SAVED_CARD_ALIAS_MAX_LENGTH } from "@movo/shared/dist/types/saved-card";
import { Check, ChevronDown, ChevronLeft, Lock, XCircle } from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  type TextInput,
  View,
} from "react-native";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useKeyboardVisible } from "../../src/hooks/use-keyboard-visible";
import { useAddSavedCard, useCardsCheckoutData } from "../../src/hooks/use-saved-cards";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { cardBrandFromNumber, cardBrandKey } from "../../src/lib/card-brand";
import {
  CARD_DNI_MAX_LENGTH,
  expectedCvvLength,
  formatCardNumberInput,
  formatExpiryInput,
  isStepValid,
  onlyDigits,
  sanitizeHolderName,
  validateCardForm,
} from "../../src/lib/card-form";
import { formatDni } from "../../src/lib/dni";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import { type CardBinInfo, lookupBin } from "../../src/lib/mp-card-tokenizer";
import { cardBrandName, cardSaveError, hasUsableCard, paymentTypeLabel } from "../../src/lib/saved-cards";
import { BankLogo } from "./bank-logo";
import { CardField } from "./card-field";
import { type CardPreviewFocus, CardPreview3D } from "./card-preview-3d";

/**
 * Alta de tarjeta en 3 pasos (MOVO-101), fiel al prototipo "MOVO-112 Pagos y cobros v2":
 * número (con el banco detectado por BIN), vencimiento y código, titular y nombre de
 * referencia. Los datos se tokenizan en el dispositivo con la `public_key` de Movo y al
 * backend solo va el token (ver `mp-card-tokenizer.ts`).
 *
 * Es reutilizable (AC6): no navega, avisa con `onSaved` y `onCancel`. MOVO-269 lo abre
 * cuando el emisor no tiene tarjetas o quiere usar otra, y recibe la tarjeta guardada.
 *
 * El número, el código y el documento viven solo en el estado local de este componente:
 * no van al store, a la cache ni a ningún log, y se pierden al desmontarlo.
 */

type Step = 1 | 2 | 3;
type Status = "form" | "saving" | "error";

const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);
const MAX_NUMBER_LENGTH = 19;

const STEP_COPY: Record<Step, [string, string]> = {
  1: ["Número de la tarjeta", "Crédito o débito. Con los primeros dígitos reconocemos tu banco."],
  2: ["Vencimiento y código", "El código lo encontrás en el dorso. Lo usamos solo para validarla."],
  3: ["Titular y nombre", "Tal como figura en el plástico. Si querés, ponele un nombre para reconocerla."],
};

export interface AddCardWizardProps {
  /** Las tarjetas que ya tiene: si ninguna está vigente, la nueva queda predeterminada sí o sí. */
  /** `undefined`: todavía no se sabe (cargando o con error). Mientras tanto no se fuerza la predeterminada. */
  cards: SavedCard[] | undefined;
  /** `defaultFailed`: quedó guardada pero no se pudo marcar como predeterminada. */
  onSaved: (card: SavedCard, info: { defaultFailed: boolean }) => void;
  onCancel: () => void;
}

function ProgressBar({ percent }: { percent: number }) {
  const colors = useThemeColors();
  const width = useSharedValue(percent);
  useEffect(() => {
    width.value = withTiming(percent, { duration: 400, easing: EASE_OUT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [percent]);
  const fill = useAnimatedStyle(() => ({ width: `${width.value}%` }));
  return (
    <View className="h-[3px] flex-1 overflow-hidden rounded-full" style={{ backgroundColor: colors.bgMute }}>
      <Animated.View className="h-full rounded-full bg-fg" style={fill} />
    </View>
  );
}

/** Switch del prototipo: pista negra y perilla lima al prenderse (distinto de `ToggleSwitch`). */
function DefaultSwitch({ on, forced, onToggle }: { on: boolean; forced: boolean; onToggle: () => void }) {
  const colors = useThemeColors();
  const progress = useSharedValue(on ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(on ? 1 : 0, { duration: 200, easing: EASE_OUT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on]);
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: progress.value * 18 }] }));
  return (
    <Pressable
      testID="add-card-default-switch"
      accessibilityRole="switch"
      accessibilityLabel="Usar como predeterminada"
      accessibilityState={{ checked: on, disabled: forced }}
      onPress={onToggle}
      disabled={forced}
      style={{
        width: 46,
        height: 28,
        borderRadius: 999,
        padding: 3,
        justifyContent: "center",
        backgroundColor: on ? colors.fg1 : "#D6D6DB",
        opacity: forced ? 0.5 : 1,
      }}
    >
      <Animated.View
        style={[
          {
            width: 22,
            height: 22,
            borderRadius: 999,
            backgroundColor: on ? "#C6F24A" : "#FFFFFF",
            shadowColor: "#0A0A0B",
            shadowOpacity: 0.2,
            shadowRadius: 1,
            shadowOffset: { width: 0, height: 1 },
          },
          knob,
        ]}
      />
    </Pressable>
  );
}

/** Con el teclado abierto la tarjeta se achica a este factor para dejar lugar al campo. */
const COMPACT_SCALE = 0.6;
const CARD_HEIGHT = 220;

/** Achica la tarjeta (desde arriba) mientras el teclado está abierto. */
function CompactCard({ compact, children }: { compact: boolean; children: ReactNode }) {
  const progress = useSharedValue(compact ? 1 : 0);
  useEffect(() => {
    progress.value = withTiming(compact ? 1 : 0, { duration: 250, easing: EASE_OUT });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);
  const outer = useAnimatedStyle(() => ({ height: CARD_HEIGHT * (1 - progress.value * (1 - COMPACT_SCALE)) }));
  const inner = useAnimatedStyle(() => ({ transform: [{ scale: 1 - progress.value * (1 - COMPACT_SCALE) }] }));
  return (
    <Animated.View testID="add-card-preview-container" style={outer}>
      <Animated.View style={[{ height: CARD_HEIGHT, transformOrigin: "top center" }, inner]}>{children}</Animated.View>
    </Animated.View>
  );
}

export function AddCardWizard({ cards, onSaved, onCancel }: AddCardWizardProps) {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const keyboardVisible = useKeyboardVisible();
  const checkoutData = useCardsCheckoutData();
  const publicKey = checkoutData.data?.publicKey ?? null;

  const [step, setStep] = useState<Step>(1);
  const [status, setStatus] = useState<Status>("form");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [focus, setFocus] = useState<CardPreviewFocus>(null);
  const [sweepKey, setSweepKey] = useState(0);
  const [num, setNum] = useState("");
  const [exp, setExp] = useState("");
  const [cvv, setCvv] = useState("");
  const [name, setName] = useState("");
  const [dni, setDni] = useState("");
  const [alias, setAlias] = useState("");
  const [makeDefault, setMakeDefault] = useState(false);
  const [bin, setBin] = useState<{ key: string; info: CardBinInfo | null } | null>(null);

  const refs = {
    num: useRef<TextInput>(null),
    exp: useRef<TextInput>(null),
    cvv: useRef<TextInput>(null),
    name: useRef<TextInput>(null),
    dni: useRef<TextInput>(null),
  };

  const add = useAddSavedCard({
    onSuccess: ({ card, defaultFailed }) => onSaved(card, { defaultFailed }),
    onError: (err) => {
      const { message, step: errorStep } = cardSaveError(err);
      setStatus("error");
      setErrorMessage(message);
      if (errorStep) setStep(errorStep);
    },
  });

  // Banco por BIN: se consulta una vez por cada 6 primeros dígitos. Si MP no responde, el
  // alta sigue igual (el rechazo real, si lo hay, lo da el token).
  const binKey = num.length >= 6 ? num.slice(0, 6) : null;
  useEffect(() => {
    if (!binKey || !publicKey || bin?.key === binKey) return;
    let cancelled = false;
    lookupBin(publicKey, binKey)
      .then((info) => {
        if (!cancelled) setBin({ key: binKey, info });
      })
      .catch(() => {
        if (!cancelled) setBin({ key: binKey, info: null });
      });
    return () => {
      cancelled = true;
    };
  }, [binKey, publicKey, bin?.key]);
  const binInfo = binKey && bin?.key === binKey ? bin.info : null;

  // Enfoca el primer campo de cada paso, como el prototipo (después de la animación).
  useEffect(() => {
    if (status !== "form") return;
    const first = step === 1 ? refs.num : step === 2 ? refs.exp : refs.name;
    const timer = setTimeout(() => first.current?.focus(), 380);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const values = { num, exp, cvv, name, dni };
  const validity = validateCardForm(values, binInfo);
  const busy = status === "saving";
  const done = Object.values(validity).filter(Boolean).length;
  const progress = busy ? 1 : done / 5;
  const stepOk = isStepValid(step, validity);
  const forcedDefault = cards !== undefined && !hasUsableCard(cards);
  const defaultOn = forcedDefault || makeDefault;
  // Si MP ya dijo la marca y no es una de las tres con logo (Naranja, Argencard...), no se
  // adivina por el primer dígito: un "5" es Mastercard solo si MP no dijo otra cosa.
  const brand = binInfo?.paymentMethodId ? cardBrandKey(binInfo.paymentMethodId) : cardBrandFromNumber(num);
  const expError = exp.length === 4 && !validity.exp;
  const cvvLength = expectedCvvLength(num, binInfo);

  const editing = () => {
    if (status === "error") setStatus("form");
  };

  const next = () => {
    if (busy || !stepOk) return;
    if (step < 3) {
      setStep((s) => (s + 1) as Step);
      setFocus(null);
      setSweepKey((k) => k + 1);
      return;
    }
    if (!publicKey) return;
    setStatus("saving");
    setErrorMessage(null);
    setFocus(null);
    add.mutate({
      publicKey,
      card: {
        cardNumber: num,
        expMonth: Number(exp.slice(0, 2)),
        expYear: 2000 + Number(exp.slice(2)),
        securityCode: cvv,
        holderName: name.trim(),
        docType: "DNI",
        docNumber: dni,
      },
      paymentMethodId: binInfo?.paymentMethodId ?? null,
      alias: alias.trim() || null,
      makeDefault: defaultOn,
    });
  };

  const back = () => {
    if (busy) return;
    if (step > 1) {
      setStep((s) => (s - 1) as Step);
      setFocus(null);
      setStatus("form");
    } else {
      onCancel();
    }
  };

  const focusProps = (key: Exclude<CardPreviewFocus, null>) => ({
    onFocusChange: (focused: boolean) => setFocus((current) => (focused ? key : current === key ? null : current)),
    onSubmitEditing: next,
  });

  const [title, subtitle] = STEP_COPY[step];
  const checkoutError =
    checkoutData.isError && !checkoutData.data
      ? friendlyErrorMessage(checkoutData.error, "No pudimos preparar el alta de tarjetas. Probá de nuevo.")
      : null;
  const primaryLabel = busy ? "Validando…" : step === 3 ? "Guardar tarjeta" : "Continuar";
  const primaryDisabled = busy || !stepOk || (step === 3 && !publicKey);

  return (
    <KeyboardAvoidingView
      testID="add-card-wizard"
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      className="flex-1 bg-bg"
    >
      <View className="gap-3.5 px-5 pt-1.5">
        <View className="flex-row items-center gap-3">
          <Pressable
            testID="add-card-back"
            accessibilityRole="button"
            accessibilityLabel="Volver"
            onPress={back}
            disabled={busy}
            className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
          >
            <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
          </Pressable>
          <View className="min-w-0 flex-1">
            <Text className="font-sans-semibold text-[17px] text-fg">Agregar tarjeta</Text>
            <Text testID="add-card-step-label" className="mt-0.5 font-sans text-[10px] uppercase tracking-[0.6px] text-fg-3">
              Paso {step} de 3
            </Text>
          </View>
        </View>
        <View className="flex-row gap-1">
          {([1, 2, 3] as const).map((i) => (
            <ProgressBar
              key={i}
              percent={busy || i < step ? 100 : i === step ? 35 + (isStepValid(i, validity) ? 65 : 0) : 0}
            />
          ))}
        </View>
      </View>

      {/* Por encima del formulario: si no, el degradé de arriba del scroll (que arranca opaco)
          tapaba la parte de abajo de la sombra y la dejaba cortada en seco. */}
      <View className={`px-5 ${keyboardVisible ? "pt-3" : "pt-5"}`} style={{ zIndex: 1, elevation: 6 }}>
        <CompactCard compact={keyboardVisible}>
          <CardPreview3D
            number={num}
            exp={exp}
            cvv={cvv}
            name={name}
            focus={focus}
            flipped={focus === "cvv" && step === 2}
            brand={brand}
            bankName={binInfo?.issuerName ?? null}
            progress={progress}
            busy={busy}
            sweepKey={sweepKey}
            error={status === "error"}
          />
        </CompactCard>
      </View>

      {/* El formulario arranca con aire debajo de la tarjeta y se desvanece arriba al hacer
          scroll, en vez de cortarse contra el borde de la tarjeta. `overflow: hidden`: sin esto
          el texto scrolleado se dibujaba debajo de la tarjeta. */}
      <View className={`flex-1 ${keyboardVisible ? "mt-3" : "mt-1.5"}`}>
        <ScrollView
          className="flex-1"
          style={{ overflow: "hidden" }}
          contentContainerClassName={`gap-4 px-5 pb-4 ${keyboardVisible ? "pt-3" : "pt-4"}`}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {checkoutError ? (
            <View testID="add-card-checkout-error" className="rounded-[10px] border border-danger-300 bg-danger-100 px-3.5 py-3">
              <Text className="font-sans text-[12.5px] leading-[18px] text-ink-950">{checkoutError}</Text>
            </View>
          ) : null}

          {status === "error" && errorMessage ? (
            <View
              testID="add-card-error"
              accessibilityLiveRegion="polite"
              className="flex-row items-start gap-2.5 rounded-[10px] border border-danger-300 bg-danger-100 px-3.5 py-3"
            >
              <XCircle size={16} color="#C22F35" strokeWidth={2} style={{ marginTop: 1 }} />
              <View className="flex-1">
                <Text className="font-sans-semibold text-[13px] text-ink-950">No pudimos validar la tarjeta</Text>
                <Text className="mt-0.5 font-sans text-[12.5px] leading-[18px] text-ink-950">{errorMessage}</Text>
              </View>
            </View>
          ) : null}

          <View className="flex-row items-end justify-between gap-3">
            <View className="min-w-0 shrink gap-1">
              <Text testID="add-card-step-title" className="font-sans-semibold text-[20px] tracking-[-0.3px] text-fg">
                {title}
              </Text>
              {keyboardVisible ? null : (
                <Text className="font-sans text-[13px] leading-[18px] text-fg-3">{subtitle}</Text>
              )}
            </View>
          </View>

          {step === 1 ? (
            <>
              <CardField
                ref={refs.num}
                testID="add-card-number"
                label="Número de tarjeta"
                mono
                value={formatCardNumberInput(num)}
                onChangeText={(text) => {
                  setNum(onlyDigits(text, MAX_NUMBER_LENGTH));
                  editing();
                }}
                keyboardType="number-pad"
                placeholder="0000 0000 0000 0000"
                {...focusProps("num")}
              />
              {binInfo?.issuerName ? (
                <View testID="add-card-bank" className="flex-row items-center gap-3 rounded-[10px] border border-border bg-bg-sub px-3 py-2.5">
                  <BankLogo issuerName={binInfo.issuerName} size={32} testID="add-card-bank-logo" />
                  <View className="min-w-0 flex-1">
                    <Text className="font-sans-semibold text-[14px] text-fg">{binInfo.issuerName}</Text>
                    <Text className="mt-px font-sans text-[12px] text-fg-3">
                      {[cardBrandName(binInfo.paymentMethodId), paymentTypeLabel(binInfo.paymentType)?.toLowerCase()]
                        .filter(Boolean)
                        .join(" ")}
                    </Text>
                  </View>
                  <Check size={16} color="#1F9760" strokeWidth={2.4} />
                </View>
              ) : null}
            </>
          ) : null}

          {step === 2 ? (
            <View className="flex-row gap-2.5">
              <View className="flex-1">
                <CardField
                  ref={refs.exp}
                  testID="add-card-exp"
                  label="Vencimiento"
                  mono
                  value={formatExpiryInput(exp)}
                  onChangeText={(text) => {
                    const nextExp = onlyDigits(text, 4);
                    setExp(nextExp);
                    editing();
                    if (nextExp.length === 4 && exp.length < 4) setTimeout(() => refs.cvv.current?.focus(), 120);
                  }}
                  keyboardType="number-pad"
                  placeholder="MM/AA"
                  error={expError ? "Revisá la fecha" : null}
                  {...focusProps("exp")}
                />
              </View>
              <View className="flex-1">
                <CardField
                  ref={refs.cvv}
                  testID="add-card-cvv"
                  label="Código de seguridad"
                  mono
                  value={cvv}
                  onChangeText={(text) => {
                    setCvv(onlyDigits(text, cvvLength));
                    editing();
                  }}
                  keyboardType="number-pad"
                  placeholder="3 o 4 dígitos"
                  autoComplete="cc-csc"
                  {...focusProps("cvv")}
                />
              </View>
            </View>
          ) : null}

          {step === 3 ? (
            <>
              <CardField
                ref={refs.name}
                testID="add-card-name"
                label="Nombre como figura en la tarjeta"
                value={name}
                onChangeText={(text) => {
                  setName(sanitizeHolderName(text));
                  editing();
                }}
                placeholder="Nombre y apellido"
                autoCapitalize="characters"
                autoComplete="cc-name"
                {...focusProps("name")}
              />
              <View className="flex-row gap-2.5">
                <View className="w-[88px] gap-1.5">
                  <Text className="font-sans-medium text-[12px] text-fg-2">Documento</Text>
                  <View className="h-[52px] flex-row items-center justify-between rounded-[6px] border border-border-strong px-3">
                    <Text className="font-sans text-[15px] text-fg">DNI</Text>
                    <ChevronDown size={14} color={colors.fg3} strokeWidth={2} />
                  </View>
                </View>
                <View className="flex-1">
                  <CardField
                    ref={refs.dni}
                    testID="add-card-dni"
                    label="Número"
                    mono
                    value={formatDni(dni)}
                    onChangeText={(text) => {
                      setDni(onlyDigits(text, CARD_DNI_MAX_LENGTH));
                      editing();
                    }}
                    keyboardType="number-pad"
                    placeholder="Sin puntos"
                    {...focusProps("dni")}
                  />
                </View>
              </View>
              <View className="gap-1.5">
                <CardField
                  testID="add-card-alias"
                  label="Nombre de la tarjeta"
                  labelHint="(opcional)"
                  labelRight={`${alias.length}/${SAVED_CARD_ALIAS_MAX_LENGTH}`}
                  value={alias}
                  onChangeText={(text) => setAlias(text.slice(0, SAVED_CARD_ALIAS_MAX_LENGTH))}
                  maxLength={SAVED_CARD_ALIAS_MAX_LENGTH}
                  placeholder="Ej: Personal, Cuenta sueldo"
                  {...focusProps("alias")}
                />
                <Text className="font-sans text-[12px] leading-4 text-fg-3">
                  Un nombre tuyo para reconocerla rápido cuando pagás o la elegís en tu lista. Solo lo ves vos. No escribas el
                  número de la tarjeta.
                </Text>
              </View>
              <View className="flex-row items-center gap-3 rounded-[10px] border border-border bg-bg-sub px-3.5 py-3">
                <View className="min-w-0 flex-1">
                  <Text className="font-sans-medium text-[14px] text-fg">Usar como predeterminada</Text>
                  <Text testID="add-card-default-hint" className="mt-0.5 font-sans text-[12px] leading-4 text-fg-3">
                    {forcedDefault
                      ? "Es tu primera tarjeta, así que va a ser la predeterminada."
                      : "Te la proponemos primero cuando pagás."}
                  </Text>
                </View>
                <DefaultSwitch on={defaultOn} forced={forcedDefault} onToggle={() => setMakeDefault((v) => !v)} />
              </View>
            </>
          ) : null}
        </ScrollView>
        <LinearGradient
          pointerEvents="none"
          colors={[colors.bg, `${colors.bg}00`]}
          style={{ position: "absolute", top: 0, left: 0, right: 0, height: 16 }}
        />
      </View>

      {/* Con el teclado abierto el pie va pegado al teclado: sin el aviso del candado ni el
          margen del home indicator (el `SafeAreaView` de la pantalla solo aplica arriba). */}
      <View
        className={`gap-2.5 bg-bg px-5 ${keyboardVisible ? "pt-2" : "pt-3"}`}
        style={{ paddingBottom: keyboardVisible ? 8 : Math.max(insets.bottom, 24) }}
      >
        {keyboardVisible ? null : (
          <View className="flex-row items-center justify-center gap-1.5">
            <Lock size={12} color={colors.fg3} strokeWidth={2.2} />
            <Text className="font-sans text-[11px] text-fg-3">Se guarda cifrada en Mercado Pago. El código no se guarda.</Text>
          </View>
        )}
        <Pressable
          testID="add-card-primary"
          accessibilityRole="button"
          accessibilityLabel={primaryLabel}
          accessibilityState={{ disabled: primaryDisabled, busy }}
          onPress={next}
          disabled={primaryDisabled}
          className={`flex-row items-center justify-center gap-2 rounded-lg ${keyboardVisible ? "h-11" : "h-[52px]"} ${
            primaryDisabled ? "bg-bg-mute" : "bg-fg active:opacity-80"
          }`}
        >
          {busy ? <ActivityIndicator testID="add-card-spinner" size="small" color={colors.fg2} /> : null}
          <Text className={`font-sans-semibold text-[15px] ${primaryDisabled ? "text-fg-3" : "text-bg"}`}>{primaryLabel}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
