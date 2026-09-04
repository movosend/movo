import { ApiError } from "@movo/shared/dist/errors/api-error";
import { router } from "expo-router";
import { Check, ShieldAlert, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import {
  SafeAreaProvider,
  SafeAreaView,
  initialWindowMetrics,
} from "react-native-safe-area-context";
import type { CreateOfferResponse } from "../../src/api/offers-client";
import type { ShipmentSummary } from "../../src/api/shipments-client";
import { useCreateOffer } from "../../src/hooks/use-offers";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import { formatPickupDateLabel, formatPriceArs } from "../../src/lib/shipment-format";
import { PrimaryButton } from "../auth/primary-button";
import { ErrorBanner } from "../ui/error-banner";
import { TextField } from "../ui/text-field";

const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

export interface CreateOfferSheetProps {
  visible: boolean;
  shipment: ShipmentSummary;
  onClose: () => void;
  onSuccess?: (offer: CreateOfferResponse) => void;
  testID?: string;
}

/**
 * Hoja de creación de oferta para el transportista (MOVO-149, frontend de MOVO-23).
 *
 * El transportista ingresa el NETO que quiere cobrar (editable, prellenado por defecto
 * con el precio sugerido del envío) y opcionalmente un mensaje. Lo que se manda al
 * backend es el neto; el backend calcula el bruto y la comisión de Movo (AC2/AC3 de la US).
 *
 * Al confirmar con éxito, muestra la confirmación con el desglose exacto de los números
 * devueltos por el backend (sin recalcular la comisión en el cliente) y permite volver
 * al listado donde la card se refleja como "Ya ofertaste".
 */
export function CreateOfferSheet({
  visible,
  shipment,
  onClose,
  onSuccess,
  testID,
}: CreateOfferSheetProps) {
  const colors = useThemeColors();
  const createOffer = useCreateOffer(shipment.id);

  const [priceNetArs, setPriceNetArs] = useState("");
  const [offeredDate, setOfferedDate] = useState(shipment.pickupDate);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<unknown | null>(null);
  const [createdOffer, setCreatedOffer] = useState<CreateOfferResponse | null>(null);

  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);

  useEffect(() => {
    if (visible) {
      setPriceNetArs(shipment.suggestedPriceArs ? String(shipment.suggestedPriceArs) : "");
      setOfferedDate(shipment.pickupDate);
      setMessage("");
      setError(null);
      setCreatedOffer(null);
    }
  }, [visible, shipment.suggestedPriceArs, shipment.pickupDate]);

  const handlePriceChange = (text: string) => {
    // Si contiene separador decimal (, o .), permitimos como máximo 2 decimales
    const parts = text.split(/[.,]/);
    if (parts.length === 2 && parts[1].length > 2) {
      const separator = text.includes(",") ? "," : ".";
      text = `${parts[0]}${separator}${parts[1].slice(0, 2)}`;
    }
    setPriceNetArs(text);
  };

  const getPriceValidation = (value: string): {
    error?: string;
    isValid: boolean;
    numericValue: number;
  } => {
    const trimmed = value.trim();
    if (!trimmed) {
      return { isValid: false, numericValue: 0 };
    }

    // Estado transitorio mientras tipea la coma o el punto (ej: "50," o "50.")
    if (/^\d+[.,]$/.test(trimmed)) {
      return { isValid: false, numericValue: 0 };
    }

    const isValidFormat = /^\d+(?:[.,]\d{1,2})?$/.test(trimmed);
    if (!isValidFormat) {
      return {
        error: "Ingresá un monto válido",
        isValid: false,
        numericValue: 0,
      };
    }

    const normalized = trimmed.replace(",", ".");
    const numeric = Number(normalized);

    if (isNaN(numeric) || numeric <= 0) {
      return {
        error: "Ingresá un monto válido",
        isValid: false,
        numericValue: 0,
      };
    }

    return {
      isValid: true,
      numericValue: numeric,
    };
  };

  const priceValidation = getPriceValidation(priceNetArs);
  const isKycError = error instanceof ApiError && error.code === "CARRIER_NOT_VERIFIED";

  const handleSubmit = async () => {
    if (!priceValidation.isValid || priceValidation.numericValue <= 0) return;
    setError(null);

    try {
      const data = await createOffer.mutateAsync({
        priceOfferedArs: priceValidation.numericValue,
        offeredDate,
        message: message.trim() || undefined,
      });
      setCreatedOffer(data);
    } catch (err) {
      setError(err);
    }
  };

  const handleFinish = () => {
    if (createdOffer && onSuccess) {
      onSuccess(createdOffer);
    } else {
      onClose();
    }
  };

  const handleGoToKyc = () => {
    onClose();
    router.push("/kyc");
  };

  const pickupLabel = formatPickupDateLabel(shipment.pickupDate) ?? shipment.pickupDate;

  return (
    <Modal
      visible={isMounted}
      animationType="none"
      transparent
      onRequestClose={onClose}
      testID={testID}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
        <KeyboardAvoidingView
          className="flex-1"
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View className="flex-1">
            <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
              <Pressable
                testID={testID ? `${testID}-backdrop` : undefined}
                onPress={onClose}
                className="flex-1 bg-black/40"
              />
            </Animated.View>

            <View className="flex-1 justify-end" pointerEvents="box-none">
              <Animated.View style={sheetStyle}>
                <SafeAreaView className="rounded-t-2xl bg-bg" edges={["bottom"]}>
                  <View className="flex-row items-center justify-between border-b border-border px-5 pb-3 pt-4">
                    <Text className="font-sans-semibold text-h3 text-fg">
                      {createdOffer ? "¡Oferta enviada!" : "Hacer una oferta"}
                    </Text>
                    <Pressable
                      testID={testID ? `${testID}-close` : undefined}
                      onPress={handleFinish}
                      className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
                    >
                      <X size={16} color={colors.fg2} />
                    </Pressable>
                  </View>

                  <ScrollView
                    className="max-h-[500px]"
                    contentContainerClassName="px-5 py-4"
                    keyboardShouldPersistTaps="handled"
                  >
                    {createdOffer ? (
                      <View testID={testID ? `${testID}-success-view` : "create-offer-success-view"} className="gap-4">
                        <View className="items-center gap-2 py-2">
                          <View className="h-12 w-12 items-center justify-center rounded-full bg-success-100">
                            <Check size={24} color="#16754A" strokeWidth={2.5} />
                          </View>
                          <Text className="text-center font-sans-medium text-body text-fg">
                            Tu oferta fue registrada
                          </Text>
                          <Text className="text-center font-sans text-small text-fg-2">
                            El emisor evaluará tu propuesta entre los transportistas interesados.
                          </Text>
                        </View>

                        <View
                          testID={testID ? `${testID}-breakdown` : "create-offer-breakdown"}
                          className="rounded-[12px] border border-border bg-bg-mute p-4"
                        >
                          <Text className="mb-3 font-sans-medium text-[12px] uppercase text-fg-3">
                            Desglose de la oferta
                          </Text>
                          <View className="gap-2.5">
                            <View className="flex-row items-center justify-between">
                              <Text className="font-sans text-small text-fg-2">Monto que cobrás (neto)</Text>
                              <Text
                                testID={testID ? `${testID}-net-price` : "create-offer-net-price"}
                                className="font-sans-semibold text-body text-fg"
                              >
                                {formatPriceArs(createdOffer.priceNetArs)}
                              </Text>
                            </View>
                            <View className="flex-row items-center justify-between">
                              <Text className="font-sans text-small text-fg-2">Comisión de Movo</Text>
                              <Text
                                testID={testID ? `${testID}-commission-price` : "create-offer-commission-price"}
                                className="font-sans text-small text-fg-3"
                              >
                                {formatPriceArs(createdOffer.commissionAmountArs)}
                              </Text>
                            </View>
                            <View className="my-1 h-px bg-border" />
                            <View className="flex-row items-center justify-between">
                              <Text className="font-sans-medium text-small text-fg">Total que paga el emisor</Text>
                              <Text
                                testID={testID ? `${testID}-gross-price` : "create-offer-gross-price"}
                                className="font-sans-semibold text-body text-fg"
                              >
                                {formatPriceArs(createdOffer.priceOffered)}
                              </Text>
                            </View>
                          </View>
                        </View>
                      </View>
                    ) : (
                      <View className="gap-3">
                        {isKycError ? (
                          <View
                            testID={testID ? `${testID}-kyc-error` : "create-offer-kyc-error"}
                            className="rounded-[10px] border border-warning-300 bg-warning-100 p-3.5"
                          >
                            <View className="flex-row items-center gap-2">
                              <ShieldAlert size={18} color="#A97714" strokeWidth={2} />
                              <Text className="font-sans-semibold text-small text-warning-700">
                                Verificación requerida
                              </Text>
                            </View>
                            <Text className="mt-1 font-sans text-small text-fg-2">
                              Necesitás verificar tu identidad para poder ofertar por envíos disponibles.
                            </Text>
                            <Pressable
                              testID={testID ? `${testID}-kyc-cta` : "create-offer-kyc-cta"}
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
                            testID={testID ? `${testID}-error` : "create-offer-error"}
                            message={friendlyErrorMessage(
                              error,
                              "No pudimos enviar tu oferta. Revisá los datos e intentá de nuevo."
                            )}
                          />
                        ) : null}

                        <View>
                          <TextField
                            testID={testID ? `${testID}-price-input` : "create-offer-price-input"}
                            label="¿Cuánto querés cobrar? (Neto en ARS)"
                            placeholder="Ej: 5000"
                            keyboardType="numeric"
                            value={priceNetArs}
                            onChangeText={handlePriceChange}
                            error={priceValidation.error}
                            rightElement={
                              priceValidation.error ? (
                                <View testID={testID ? `${testID}-price-error-icon` : "create-offer-price-error-icon"}>
                                  <X size={16} color="#E5484D" strokeWidth={2.2} />
                                </View>
                              ) : undefined
                            }
                          />
                          {!priceValidation.error ? (
                            <Text className="font-sans text-caption text-fg-3">
                              Monto neto que vas a recibir. El servidor calculará la comisión y el precio que verá el emisor.
                            </Text>
                          ) : null}
                        </View>

                        <View>
                          <TextField
                            testID={testID ? `${testID}-date-input` : "create-offer-date-input"}
                            label="Fecha del viaje"
                            value={`${pickupLabel} (${offeredDate})`}
                            disabled
                          />
                          <Text className="font-sans text-caption text-fg-3">
                            La fecha de la oferta coincide con la fecha de retiro solicitada por el emisor.
                          </Text>
                        </View>

                        <View>
                          <TextField
                            testID={testID ? `${testID}-message-input` : "create-offer-message-input"}
                            label="Mensaje para el emisor (opcional)"
                            placeholder="Ej: Salgo por la mañana, tengo espacio disponible en el baúl."
                            value={message}
                            onChangeText={setMessage}
                            maxLength={500}
                            multiline
                            numberOfLines={3}
                            textAlignVertical="top"
                            containerClassName="gap-1.5"
                          />
                          <Text className="font-sans text-caption text-fg-3">
                            Podés contarle detalles sobre tu vehículo o disponibilidad horaria.
                          </Text>
                        </View>
                      </View>
                    )}
                  </ScrollView>

                  {createdOffer ? (
                    <PrimaryButton
                      testID={testID ? `${testID}-success-cta` : "create-offer-success-cta"}
                      label="Volver a envíos"
                      onPress={handleFinish}
                    />
                  ) : (
                    <PrimaryButton
                      testID={testID ? `${testID}-submit` : "create-offer-submit"}
                      label="Enviar oferta"
                      onPress={handleSubmit}
                      disabled={!priceValidation.isValid}
                      loading={createOffer.isPending}
                    />
                  )}
                </SafeAreaView>
              </Animated.View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaProvider>
    </Modal>
  );
}
