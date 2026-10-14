import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { onlyDigits } from "../../src/lib/card-form";
import { cvvLengthFor } from "../../src/lib/pay-shipment-format";
import { cardLabel, cardMeta, cardTitle, isCardExpired } from "../../src/lib/saved-cards";
import { SavedCardMark } from "./saved-cards-list";

/**
 * Fila de tarjeta guardada del selector de pago (MOVO-269), fiel al prototipo "Pago con
 * tarjeta v3": radio, marca, nombre (o marca + últimos 4) y, en la elegida, el campo del código
 * de seguridad debajo. Los últimos 4 se ven siempre, aunque la tarjeta tenga nombre.
 *
 * El código vive solo en el estado del padre mientras la pantalla está abierta: es un campo
 * seguro (sin autocompletar ni texto visible), no se guarda ni se loguea.
 */

interface PayCardRowProps {
  card: SavedCard;
  selected: boolean;
  /** Mientras hay un intento en curso no se puede cambiar de tarjeta ni editar el código. */
  locked: boolean;
  cvv: string;
  /** El código es lo que falló: borde rojo y el texto de ayuda pasa a error. */
  cvvError: boolean;
  onSelect: () => void;
  onCvvChange: (value: string) => void;
  onSubmit: () => void;
}

export function PayCardRow({ card, selected, locked, cvv, cvvError, onSelect, onCvvChange, onSubmit }: PayCardRowProps) {
  const colors = useThemeColors();
  const [focused, setFocused] = useState(false);
  const expired = isCardExpired(card);
  const length = cvvLengthFor(card);
  const showCvv = selected && !expired;
  // El nombre de referencia, si lo tiene, es el título; los últimos 4 van siempre en la meta.
  const sub = `${card.alias ? `${cardTitle(card)} · ` : ""}${cardMeta(card)}${expired ? " · No se puede usar" : ""}`;
  const borderColor = focused ? colors.fg1 : cvvError ? "#E5484D" : colors.borderStrong;

  return (
    <View
      testID={`pay-card-${card.id}`}
      className={`rounded-[10px] ${selected ? "bg-bg-sub" : "bg-bg"} ${expired ? "opacity-60" : ""}`}
      style={{
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? colors.fg1 : colors.border,
        margin: selected ? 0 : 0.5,
      }}
    >
      <Pressable
        testID={`pay-card-select-${card.id}`}
        accessibilityRole="radio"
        accessibilityLabel={`${cardLabel(card)}, ${sub}`}
        accessibilityState={{ selected, disabled: expired || locked }}
        onPress={onSelect}
        disabled={expired || locked}
        className="flex-row items-center gap-3 p-3.5"
      >
        <View
          className="h-5 w-5 rounded-full bg-bg"
          style={{ borderWidth: selected ? 6 : 1.5, borderColor: selected ? colors.fg1 : colors.borderStrong }}
        />
        <SavedCardMark card={card} />
        <View className="min-w-0 flex-1">
          <Text numberOfLines={1} className="font-sans-medium text-[15px] text-fg">
            {cardLabel(card)}
          </Text>
          <Text numberOfLines={2} className={`mt-0.5 font-sans text-[12.5px] ${expired ? "text-danger-600" : "text-fg-3"}`}>
            {sub}
          </Text>
        </View>
        {card.isDefault ? (
          <View className="shrink-0 rounded-full bg-fg px-[7px] py-0.5">
            <Text className="font-sans-medium text-[10px] leading-[14px] text-bg">Predeterminada</Text>
          </View>
        ) : null}
      </Pressable>

      {showCvv ? (
        <View className="gap-1.5 pb-3.5 pl-[46px] pr-3.5">
          {/* El label ocupa todo el ancho (una sola línea) y el texto de ayuda se centra contra el
              campo, no contra el bloque label + campo: así no se desalinean si el label cambia. */}
          <Text numberOfLines={1} className="font-sans-medium text-[12px] text-fg-2">
            Código de seguridad
          </Text>
          <View className="flex-row items-center gap-3">
            <View className="w-32 shrink-0">
              <View
                style={{
                  margin: -4,
                  padding: 4,
                  borderRadius: 10,
                  backgroundColor: focused ? "rgba(198,242,74,0.35)" : "transparent",
                }}
              >
                <TextInput
                  testID="pay-cvv"
                  accessibilityLabel="Código de seguridad"
                  value={cvv}
                  onChangeText={(text) => onCvvChange(onlyDigits(text, length))}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  onSubmitEditing={onSubmit}
                  editable={!locked}
                  secureTextEntry
                  keyboardType="number-pad"
                  maxLength={length}
                  placeholder={length === 4 ? "••••" : "•••"}
                  placeholderTextColor={colors.fg3}
                  autoComplete="off"
                  autoCorrect={false}
                  importantForAutofill="no"
                  textContentType="none"
                  contextMenuHidden
                  textAlign="center"
                  style={{
                    height: 48,
                    borderRadius: 6,
                    borderWidth: focused ? 1.5 : 1,
                    borderColor,
                    paddingHorizontal: focused ? 11.5 : 12,
                    fontFamily: "JetBrainsMono_400Regular",
                    fontSize: 18,
                    letterSpacing: 5.4,
                    color: colors.fg1,
                    backgroundColor: colors.bg,
                  }}
                />
              </View>
            </View>
            <Text
              testID="pay-cvv-hint"
              className={`flex-1 font-sans text-[12px] leading-[17px] ${cvvError ? "text-danger-600" : "text-fg-3"}`}
            >
              {cvvError
                ? "El código no coincide con la tarjeta. No se cobró nada."
                : length === 4
                  ? "Los 4 dígitos del frente de la tarjeta."
                  : "Los 3 dígitos del dorso de la tarjeta."}
            </Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
