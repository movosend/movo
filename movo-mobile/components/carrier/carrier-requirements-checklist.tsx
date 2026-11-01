import type { MpConnectStatusResponse } from "@movo/shared/dist/types/mp-connect";
import { KycStatus } from "@movo/shared/dist/types/user";
import * as Haptics from "expo-haptics";
import { Banknote, IdCard, Receipt, Wallet } from "lucide-react-native";
import { useCallback, useRef } from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { useTourAnchor } from "../../src/hooks/use-tour-anchor";
import {
  type ChecklistRequirement,
  licenseRowCopy,
  mpRowCopy,
  type RequirementRowCopy,
} from "../../src/lib/carrier-requirements";
import { BottomSheetModal } from "../ui/bottom-sheet-modal";
import { PressableScale } from "../trips/pressable-scale";

/**
 * Qué acción intentó el transportista (o si es la entrada al tab): solo cambia la frase
 * de introducción. `offer`/`trip` son los dos contextos del prototipo de MOVO-117; el
 * resto sigue la misma frase para las demás acciones que bloquea DD-036.
 */
export type CarrierRequirementsContext = "offer" | "trip" | "start" | "edit_offer" | "gate";

const CONTEXT_INTRO: Record<CarrierRequirementsContext, string> = {
  offer: "Para ofertar en este envío",
  trip: "Para declarar tu viaje",
  start: "Para iniciar tu viaje",
  edit_offer: "Para editar tu oferta",
  gate: "Para ver y ofertar envíos",
};

// Corte fijo: el prototipo parte el título después de "esto" (`text-wrap: pretty`), y sin el
// salto explícito en un teléfono más ancho entra en una sola línea y deja de verse igual.
const TITLE = "Te falta completar esto\npara transportar";

const PILL_CLASS: Record<RequirementRowCopy["state"], { bg: string; text: string }> = {
  pending: { bg: "bg-warning-100", text: "text-warning-700" },
  review: { bg: "bg-warning-100", text: "text-warning-700" },
  done: { bg: "bg-success-100", text: "text-success-700" },
};

/** Las filas de deuda solo aparecen si faltan: se resuelven pagando el saldo, no completando un paso. */
type DebtRequirement = Extract<ChecklistRequirement, "no_overdue_debt" | "cash_debt_within_limit">;

const DEBT_ROWS: readonly { requirement: DebtRequirement; testIDSuffix: string; copy: RequirementRowCopy }[] = [
  {
    requirement: "no_overdue_debt",
    testIDSuffix: "debt",
    copy: {
      title: "Saldo pendiente vencido",
      state: "pending",
      pillLabel: "Pendiente",
      body: "Tenés una deuda vencida con Movo. Pagala para volver a ofertar y declarar viajes.",
      ctaLabel: "Pagar mi saldo",
    },
  },
  {
    // MOVO-37: tope de deuda para envíos en efectivo, donde cada entrega le suma la comisión como deuda.
    requirement: "cash_debt_within_limit",
    testIDSuffix: "cash-debt",
    copy: {
      title: "Saldo por encima del tope para efectivo",
      state: "pending",
      pillLabel: "Pendiente",
      body: "Tu saldo pendiente con Movo superó el tope para llevar envíos en efectivo. Pagalo para volver a ofertar en ellos; en los envíos con tarjeta podés seguir operando.",
      ctaLabel: "Pagar mi saldo",
    },
  },
];

const PENDING_COUNT_WORD = ["", "un", "dos", "tres", "cuatro"];

export interface CarrierRequirementsChecklistProps {
  /** Requisitos que faltan (`resolveTransportGate` o `details.missingRequirements`). */
  missing: ChecklistRequirement[];
  licenseStatus: KycStatus | null;
  mpStatus: MpConnectStatusResponse["status"] | null;
  context: CarrierRequirementsContext;
  onPressLicense: () => void;
  onPressMp: () => void;
  onPressDebt?: () => void;
  /** "Después". Sin handler no se muestra (no hay a dónde volver). */
  onLater?: () => void;
  testID?: string;
}

function RequirementRow({
  requirement,
  copy,
  onPressCta,
  isLast,
  testID,
}: {
  requirement: ChecklistRequirement;
  copy: RequirementRowCopy;
  onPressCta: () => void;
  isLast: boolean;
  testID: string;
}) {
  const colors = useThemeColors();
  const Icon =
    requirement === "license"
      ? IdCard
      : requirement === "mp_account"
        ? Wallet
        : requirement === "cash_debt_within_limit"
          ? Banknote
          : Receipt;
  const pill = PILL_CLASS[copy.state];
  return (
    <View testID={testID} className={`gap-3 p-4 ${isLast ? "" : "border-b border-border"}`}>
      <View className="flex-row items-start gap-3">
        <View className="h-9 w-9 items-center justify-center rounded-full border border-border bg-bg">
          <Icon size={17} strokeWidth={1.8} color={colors.fg2} />
        </View>
        <View className="flex-1">
          <View className="flex-row items-center justify-between gap-2">
            <Text className="flex-1 font-sans-semibold text-[14px] text-fg">{copy.title}</Text>
            <View testID={`${testID}-pill`} className={`rounded-full px-[9px] py-[3px] ${pill.bg}`}>
              <Text className={`font-sans-medium text-[11px] ${pill.text}`}>{copy.pillLabel}</Text>
            </View>
          </View>
          <Text className="mt-[3px] font-sans text-[12.5px] leading-[18px] text-fg-2">{copy.body}</Text>
        </View>
      </View>
      {copy.ctaLabel ? (
        <PressableScale
          testID={`${testID}-cta`}
          accessibilityRole="button"
          onPress={() => {
            // Sin `.catch`, un dispositivo sin haptics deja un rechazo sin manejar.
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onPressCta();
          }}
          style={{ borderRadius: 999 }}
          className="items-center rounded-full bg-lime-500 py-[11px]"
        >
          <Text className="font-sans-semibold text-[14px] text-ink-950">{copy.ctaLabel}</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

/**
 * Checklist de requisitos para operar como transportista (MOVO-117, prototipo "Requisitos
 * para transportar"): título, contador N/2 en lima, barra de dos segmentos, una fila por
 * requisito con su pill y CTA, y "Después". El contenido es el mismo en la pantalla del tab
 * y en el sheet (`CarrierRequirementsScreen`/`CarrierRequirementsSheet`). Solo UX: la
 * validación autoritativa es del backend (DD-036, MOVO-116).
 */
export function CarrierRequirementsChecklist({
  missing,
  licenseStatus,
  mpStatus,
  context,
  onPressLicense,
  onPressMp,
  onPressDebt,
  onLater,
  testID = "carrier-requirements",
}: CarrierRequirementsChecklistProps) {
  const licenseMissing = missing.includes("license");
  const mpMissing = missing.includes("mp_account");
  const debtRows = DEBT_ROWS.filter((row) => missing.includes(row.requirement));
  // Licencia y MP siempre se dibujan (hechos o no); las deudas, solo las que faltan.
  const TOTAL = 2 + debtRows.length;
  const done = TOTAL - (licenseMissing ? 1 : 0) - (mpMissing ? 1 : 0) - debtRows.length;

  // Un requisito que el backend reporta faltante pero cuyo estado local dice "aprobado/vinculado"
  // (estado del cliente viejo) se muestra pendiente: el backend es la autoridad.
  const license = licenseMissing
    ? licenseRowCopy(licenseStatus === KycStatus.APPROVED ? KycStatus.NOT_STARTED : licenseStatus)
    : licenseRowCopy(KycStatus.APPROVED);
  const mp = mpMissing ? mpRowCopy(mpStatus === "linked" ? "unlinked" : mpStatus) : mpRowCopy("linked");

  const pendingCount = TOTAL - done;
  const intro = `${CONTEXT_INTRO[context]} ${pendingCount === 1 ? "te queda un solo paso." : `necesitás completar estos ${PENDING_COUNT_WORD[pendingCount] ?? pendingCount} pasos.`}`;

  return (
    <View testID={testID} className="gap-[14px]">
      <View className="flex-row items-start justify-between gap-3">
        <Text className="flex-1 font-sans-semibold text-[17px] leading-[22px] text-fg">{TITLE}</Text>
        <Text testID={`${testID}-counter`} className="pt-[3px] font-sans-semibold text-[13px] text-lime-600">
          {done}/{TOTAL}
        </Text>
      </View>

      <View className="h-[6px] flex-row gap-[6px]">
        {Array.from({ length: TOTAL }, (_, i) => (
          <View
            key={i}
            testID={`${testID}-seg-${i + 1}`}
            className={`h-full flex-1 rounded-full ${done >= i + 1 ? "bg-lime-500" : "bg-bg-mute"}`}
          />
        ))}
      </View>

      <Text className="font-sans text-[13.5px] leading-[19px] text-fg-2">{intro}</Text>

      <View className="overflow-hidden rounded-2xl border border-border bg-bg-sub">
        <RequirementRow
          requirement="license"
          copy={license}
          onPressCta={onPressLicense}
          isLast={false}
          testID={`${testID}-license`}
        />
        <RequirementRow
          requirement="mp_account"
          copy={mp}
          onPressCta={onPressMp}
          isLast={debtRows.length === 0}
          testID={`${testID}-mp`}
        />
        {debtRows.map((row, index) => (
          <RequirementRow
            key={row.requirement}
            requirement={row.requirement}
            copy={row.copy}
            onPressCta={onPressDebt ?? (() => {})}
            isLast={index === debtRows.length - 1}
            testID={`${testID}-${row.testIDSuffix}`}
          />
        ))}
      </View>

      {onLater ? (
        <PressableScale
          testID={`${testID}-later`}
          accessibilityRole="button"
          onPress={onLater}
          className="items-center py-[6px]"
        >
          <Text className="font-sans-medium text-[14px] text-fg-3">Después</Text>
        </PressableScale>
      ) : null}
    </View>
  );
}

/** Espacio bajo la hoja, sin el inset inferior, para la tab bar flotante (pill + margen + aire). */
const TAB_BAR_CLEARANCE = 80;

export interface CarrierRequirementsScreenProps extends CarrierRequirementsChecklistProps {
  refreshing: boolean;
  onRefresh: () => void;
}

/**
 * Contenedor de la entrada al tab Transportar: el mismo diseño del prototipo (hoja blanca
 * anclada abajo, manija, sobre el contenido oscurecido al 40%), pero fijo en la pantalla
 * en vez de un `Modal` — no se cierra, se resuelve o se sale con "Después". Se monta como
 * hermano absoluto del contenido del tab para que oscurezca también el título. Pull-to-refresh
 * para destrabarse sin salir (AC4 de MOVO-117). La hoja es una tarjeta que termina arriba de la
 * tab bar flotante, así la barra no tapa ni se superpone con la checklist.
 */
export function CarrierRequirementsScreen({
  refreshing,
  onRefresh,
  testID = "carrier-requirements-screen",
  ...checklist
}: CarrierRequirementsScreenProps) {
  const insets = useSafeAreaInsets();
  // MOVO-169: último paso del Tour 1 ("Esto te falta para transportar").
  const tourAnchor = useTourAnchor("carrier-requirements-card", { radius: 24 });
  return (
    <View testID={`${testID}-overlay`} style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View pointerEvents="none" style={StyleSheet.absoluteFill} className="bg-black/40" />
      <ScrollView
        testID={testID}
        accessibilityViewIsModal
        contentContainerClassName="grow justify-end px-3"
        // La tab bar flotante queda libre debajo: la hoja es una tarjeta que termina arriba de ella.
        contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#FFFFFF" />}
      >
        <View ref={tourAnchor.ref} className="gap-[14px] rounded-[24px] bg-bg px-5 pb-4 pt-5">
          <View className="-mt-2 items-center">
            <View className="h-[5px] w-9 rounded-full bg-ink-200" />
          </View>
          <CarrierRequirementsChecklist {...checklist} testID={`${testID}-checklist`} />
        </View>
      </ScrollView>
    </View>
  );
}

export interface CarrierRequirementsSheetProps
  extends Omit<CarrierRequirementsChecklistProps, "onLater" | "testID"> {
  visible: boolean;
  onClose: () => void;
}

/**
 * Contenedor de bottom sheet (respuesta a un 403 del backend). Tocar un CTA cierra el sheet
 * y recién cuando termina de cerrarse (`onClosed`) navega: iOS no presenta una pantalla
 * nueva con un `Modal` todavía abierto encima.
 */
export function CarrierRequirementsSheet({
  visible,
  onClose,
  onPressLicense,
  onPressMp,
  onPressDebt,
  ...checklist
}: CarrierRequirementsSheetProps) {
  const pendingAction = useRef<(() => void) | null>(null);

  const runAfterClose = useCallback(
    (action: () => void) => {
      pendingAction.current = action;
      onClose();
    },
    [onClose],
  );

  const handleClosed = useCallback(() => {
    const action = pendingAction.current;
    pendingAction.current = null;
    action?.();
  }, []);

  return (
    <BottomSheetModal
      visible={visible}
      onRequestClose={onClose}
      onClosed={handleClosed}
      testID="carrier-requirements-sheet"
      backdropTestID="carrier-requirements-sheet-backdrop"
      sheetClassName="rounded-t-[24px] bg-bg px-5 pt-5"
      contentClassName="gap-[14px] pb-2"
    >
      <View className="-mt-2 items-center">
        <View className="h-[5px] w-9 rounded-full bg-ink-200" />
      </View>
      <CarrierRequirementsChecklist
        {...checklist}
        onPressLicense={() => runAfterClose(onPressLicense)}
        onPressMp={() => runAfterClose(onPressMp)}
        onPressDebt={() => onPressDebt && runAfterClose(onPressDebt)}
        onLater={onClose}
        testID="carrier-requirements-sheet-checklist"
      />
    </BottomSheetModal>
  );
}
