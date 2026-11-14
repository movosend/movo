import * as Haptics from "expo-haptics";
import { useRef, useState } from "react";
import { ScrollView, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import type { ActiveShipmentItem } from "../../src/lib/active-shipment-format";
import { ActiveShipmentCard } from "./active-shipment-card";
import { ACTIVE_CARD_SKELETON_HEIGHT, HomeSectionSkeleton } from "./home-section-states";

/**
 * Sección de envíos activos de Inicio (MOVO-193 AC1): "Envíos en curso", los que mandás y los que recibís juntos
 * (`mergeActiveShipments`), cada tarjeta con su rol (`showRole`). No se renderiza si no hay envíos (AC2), nunca un
 * placeholder vacío.
 *
 * MOVO-168: mientras la query carga muestra el skeleton de su card. Si falla sin datos no se
 * muestra: no sabemos si la sección te corresponde, y el aviso de falla es uno solo para
 * todo Inicio (`home.tsx`). Con envíos ya cargados la lista manda, aunque un refetch falle.
 */
export function RoleSection({
  title,
  items,
  showRole = false,
  chatByShipment,
  testID,
  isLoading = false,
}: {
  title: string;
  items: ActiveShipmentItem[];
  /** Rótulo "Enviás"/"Recibís" en cada tarjeta: necesario cuando la lista mezcla los dos lados. */
  showRole?: boolean;
  /** MOVO-284: envíos que ya tienen chat, con su contador de no leídos. */
  chatByShipment?: Record<string, { unreadCount: number }>;
  testID?: string;
  isLoading?: boolean;
}) {
  if (items.length === 0) {
    if (isLoading) {
      return <HomeSectionSkeleton testID={`${testID}-skeleton`} cardHeight={ACTIVE_CARD_SKELETON_HEIGHT} />;
    }
    // Fallida y sin datos no sabemos si la sección te corresponde: no se muestra. El aviso
    // de falla es uno solo para todo Inicio (`HomeSectionsError` en `home.tsx`).
    return null;
  }

  if (items.length === 1) {
    return (
      <View testID={testID} className="mb-6 gap-2.5">
        <Text className="font-sans-medium text-caption uppercase text-fg-3">{title}</Text>
        {renderCard(items[0])}
      </View>
    );
  }

  return <RoleCarousel title={title} items={items} renderCard={renderCard} testID={testID} />;

  function renderCard({ shipment, role }: ActiveShipmentItem, width?: number) {
    return (
      <View key={`${role}-${shipment.id}`} style={width ? { width } : undefined}>
        <ActiveShipmentCard
          shipment={shipment}
          role={role}
          showRole={showRole}
          chat={chatByShipment?.[shipment.id]}
          testID={`${testID}-card-${shipment.id}`}
        />
      </View>
    );
  }
}

/** Padding horizontal del contenido de Inicio (`px-6`): el carrusel lo sangra para llegar al borde de la pantalla. */
const HOME_GUTTER = 24;
const CARD_GAP = 10;
/** Cuánto asoma la tarjeta siguiente, para que se note que hay más. */
const NEXT_CARD_PEEK = 18;
/**
 * Aire arriba y abajo de las tarjetas dentro del carrusel: un `ScrollView` horizontal recorta lo que se dibuja fuera
 * de su caja, y la sombra de la tarjeta (radio 10, desplazada 6 hacia abajo) quedaba cortada. Se compensa con margen
 * negativo, así el carrusel ocupa lo mismo en Inicio.
 */
const SHADOW_ROOM = 12;

/**
 * Con más de un envío, las tarjetas van en un carrusel horizontal (una por slide, asomando la siguiente) en vez de
 * apiladas en vertical, que empujaban el resto de Inicio fuera de la pantalla. Contador en el título y puntos abajo,
 * el mismo lenguaje que el carrusel de reseñas del perfil.
 */
function RoleCarousel({
  title,
  items,
  renderCard,
  testID,
}: {
  title: string;
  items: ActiveShipmentItem[];
  renderCard: (item: ActiveShipmentItem, width?: number) => React.ReactNode;
  testID?: string;
}) {
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  // Hasta medir, un ancho razonable: la primera tarjeta se ve completa y no salta al medir.
  const cardWidth = layoutWidth > 0 ? layoutWidth - HOME_GUTTER * 2 - NEXT_CARD_PEEK - CARD_GAP : 320;
  const interval = cardWidth + CARD_GAP;

  const activeIndexRef = useRef(0);
  // Si la lista se achica con el carrusel montado (un envío sale de "en curso" estando en la última tarjeta), el índice
  // guardado queda fuera de rango: se acota al dibujar para no mostrar "3 de 2" ni perder el punto activo (review PR #343).
  const shownIndex = Math.max(0, Math.min(activeIndex, items.length - 1));
  activeIndexRef.current = Math.min(activeIndexRef.current, Math.max(0, items.length - 1));

  // Al cruzar a otra tarjeta mientras se desliza: actualiza el contador y vibra (selección, como el slider de confirmar).
  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.max(0, Math.min(Math.round(event.nativeEvent.contentOffset.x / interval), items.length - 1));
    if (index === activeIndexRef.current) return;
    activeIndexRef.current = index;
    setActiveIndex(index);
    void Haptics.selectionAsync().catch(() => undefined);
  };

  return (
    <View testID={testID} className="mb-6 gap-2.5">
      <View className="flex-row items-center justify-between">
        <Text className="font-sans-medium text-caption uppercase text-fg-3">{title}</Text>
        <Text testID={testID ? `${testID}-counter` : undefined} className="font-sans-medium text-caption text-fg-3">
          {`${shownIndex + 1} de ${items.length}`}
        </Text>
      </View>
      <ScrollView
        testID={testID ? `${testID}-carousel` : undefined}
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={interval}
        disableIntervalMomentum
        onScroll={handleScroll}
        scrollEventThrottle={16}
        onLayout={(event) => setLayoutWidth(Math.round(event.nativeEvent.layout.width))}
        style={{ marginHorizontal: -HOME_GUTTER, marginVertical: -SHADOW_ROOM }}
        contentContainerStyle={{
          paddingHorizontal: HOME_GUTTER,
          paddingVertical: SHADOW_ROOM,
          gap: CARD_GAP,
          alignItems: "flex-start",
        }}
      >
        {items.map((item) => renderCard(item, cardWidth))}
      </ScrollView>
      <View className="flex-row items-center justify-center gap-1.5 pt-1">
        {items.map(({ shipment, role }, index) => (
          <View
            key={`${role}-${shipment.id}`}
            style={{ width: index === shownIndex ? 14 : 5, height: 5 }}
            className={`rounded-full ${index === shownIndex ? "bg-lime-500" : "bg-bg-mute"}`}
          />
        ))}
      </View>
    </View>
  );
}
