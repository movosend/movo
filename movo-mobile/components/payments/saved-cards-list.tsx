import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { AlertTriangle, Check, CreditCard, MoreHorizontal, Plus } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { STATE_COLORS } from "../../src/constants/state-colors";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { cardBrandKey } from "../../src/lib/card-brand";
import {
  cardBrandName,
  cardIssuerName,
  cardLabel,
  cardMeta,
  cardTitle,
  hasUsableCard,
  isCardExpired,
  sortSavedCards,
} from "../../src/lib/saved-cards";
import { SkeletonBlock } from "../ui/skeleton-block";
import { BankLogo } from "./bank-logo";
import { CardBrandLogo } from "./card-brand-logo";
import { PaymentMethodActionRow, PaymentMethodsEmpty, PaymentMethodTile } from "./payment-method-list";

/**
 * Sección "Medios de pago" de "Pagos y cobros" (MOVO-101), fiel al prototipo de Claude
 * Design "MOVO-112 Pagos y cobros v3": lista de tarjetas con la predeterminada marcada,
 * fila "Agregar tarjeta" y estado vacío. No hace fetch: recibe las tarjetas y callbacks.
 */

/** Recuadro con el logo de la marca (44×30 en la lista, 52×36 en la hoja de opciones). */
export function CardBrandBox({ brand, size = "md", testID }: { brand: string; size?: "md" | "lg"; testID?: string }) {
  const colors = useThemeColors();
  const lg = size === "lg";
  return (
    <PaymentMethodTile size={size} testID={testID}>
      {cardBrandKey(brand) ? (
        <CardBrandLogo brand={brand} size={lg ? 18 : 16} color={colors.fg1} />
      ) : (
        <Text numberOfLines={1} className="px-0.5 font-sans-semibold text-[9px] text-fg-2">
          {cardBrandName(brand)}
        </Text>
      )}
    </PaymentMethodTile>
  );
}

/**
 * Recuadro de una tarjeta guardada: el logo del banco emisor y, si MP no informó el banco
 * (o es Amex), el de la marca. Ocupa el mismo ancho que `CardBrandBox` para que los textos
 * de la lista queden alineados con la fila "Agregar tarjeta".
 */
export function SavedCardMark({ card, size = "md" }: { card: SavedCard; size?: "md" | "lg" }) {
  const issuer = cardIssuerName(card);
  if (!issuer) return <CardBrandBox brand={card.brand} size={size} testID={`saved-card-brand-${card.id}`} />;
  const lg = size === "lg";
  return (
    <View testID={`saved-card-bank-${card.id}`} className={`shrink-0 items-center ${lg ? "w-[52px]" : "w-11"}`}>
      <BankLogo issuerName={issuer} size={lg ? 40 : 34} />
    </View>
  );
}

function SavedCardRow({ card, onPress }: { card: SavedCard; onPress: () => void }) {
  const colors = useThemeColors();
  const expired = isCardExpired(card);
  return (
    <Pressable
      testID={`saved-card-row-${card.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${cardLabel(card)}${card.isDefault ? ", predeterminada" : ""}. ${cardMeta(card)}`}
      accessibilityHint="Abre las opciones de la tarjeta"
      onPress={onPress}
      className="flex-row items-center gap-3 border-b border-border px-4 py-3.5 active:bg-bg-sub"
    >
      <SavedCardMark card={card} />
      <View className="min-w-0 flex-1 gap-0.5">
        <Text numberOfLines={1} className="font-sans-semibold text-[15px] leading-5 text-fg">
          {cardLabel(card)}
        </Text>
        {card.alias ? (
          <Text className="font-mono text-[12px] leading-4 text-fg-2">{cardTitle(card)}</Text>
        ) : null}
        <Text
          testID={`saved-card-meta-${card.id}`}
          className={`font-sans text-[12px] leading-4 ${expired ? "text-danger-600" : "text-fg-3"}`}
        >
          {cardMeta(card)}
        </Text>
      </View>
      {card.isDefault ? (
        <View
          testID={`saved-card-default-${card.id}`}
          accessibilityLabel="Predeterminada"
          className="h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fg"
        >
          <Check size={12} color={colors.bg} strokeWidth={3} />
        </View>
      ) : null}
      <MoreHorizontal size={18} color={colors.fg3} strokeWidth={2} />
    </Pressable>
  );
}

export function SavedCardsEmpty({ onAdd }: { onAdd: () => void }) {
  const colors = useThemeColors();
  return (
    <PaymentMethodsEmpty
      testID="saved-cards-empty"
      actionTestID="saved-cards-empty-add"
      icon={<CreditCard size={22} color={colors.fg2} strokeWidth={1.8} />}
      title="Todavía no guardaste tarjetas"
      body="Agregá una y la próxima vez que pagues un envío solo te pedimos el código."
      actionLabel="Agregar tarjeta"
      onAction={onAdd}
    />
  );
}

export function SavedCardsSkeleton() {
  return (
    <View testID="saved-cards-loading" className="overflow-hidden rounded-[10px] border border-border">
      {[0, 1].map((i) => (
        <View key={i} className="flex-row items-center gap-3 border-b border-border px-4 py-3.5">
          <SkeletonBlock className="h-[30px] w-11 rounded-[5px]" />
          <View className="flex-1 gap-1.5">
            <SkeletonBlock className="h-3.5 w-[140px] rounded-md" />
            <SkeletonBlock className="h-3 w-[110px] rounded-md" />
          </View>
        </View>
      ))}
      <View className="flex-row items-center gap-3 px-4 py-3.5">
        <SkeletonBlock className="h-[30px] w-11 rounded-[5px]" />
        <SkeletonBlock className="h-3.5 w-[120px] rounded-md" />
      </View>
    </View>
  );
}

export function SavedCardsList({
  cards,
  onOpenCard,
  onAdd,
}: {
  cards: SavedCard[];
  onOpenCard: (card: SavedCard) => void;
  onAdd: () => void;
}) {
  if (cards.length === 0) return <SavedCardsEmpty onAdd={onAdd} />;
  return (
    <>
      <View testID="saved-cards-list" className="overflow-hidden rounded-[10px] border border-border bg-bg">
        {sortSavedCards(cards).map((card) => (
          <SavedCardRow key={card.id} card={card} onPress={() => onOpenCard(card)} />
        ))}
        <PaymentMethodActionRow testID="saved-cards-add-row" icon={Plus} label="Agregar tarjeta" onPress={onAdd} />
      </View>
      {hasUsableCard(cards) ? null : (
        <View
          testID="saved-cards-no-usable"
          className="flex-row items-start gap-2 rounded-[10px] border border-warning-300 bg-warning-100 px-3 py-2.5"
        >
          <AlertTriangle size={15} strokeWidth={2.2} color={STATE_COLORS.warning700} style={{ marginTop: 1 }} />
          <Text className="flex-1 font-sans text-[12.5px] leading-[17px] text-ink-950">
            No tenés tarjetas vigentes. Agregá una para pagar tu próximo envío.
          </Text>
        </View>
      )}
    </>
  );
}
