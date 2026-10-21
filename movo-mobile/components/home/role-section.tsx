import { Text, View } from "react-native";
import type { ActiveShipmentSummary } from "../../src/api/shipments-client";
import type { ActiveShipmentRole } from "../../src/lib/active-shipment-format";
import { ActiveShipmentCard } from "./active-shipment-card";
import { ACTIVE_CARD_SKELETON_HEIGHT, HomeSectionError, HomeSectionSkeleton } from "./home-section-states";

/**
 * Sección de envíos activos de un rol ("Estoy enviando"/"Voy a recibir", MOVO-193
 * AC1) — no se renderiza si no hay envíos (AC2), nunca un placeholder vacío.
 *
 * MOVO-168: mientras la query carga muestra el skeleton de su card, y si falla un aviso
 * con "Reintentar" local. Con envíos ya cargados la lista manda, aunque un refetch falle.
 */
export function RoleSection({
  title,
  role,
  shipments,
  chatByShipment,
  testID,
  isLoading = false,
  isError = false,
  onRetry,
}: {
  title: string;
  role: ActiveShipmentRole;
  shipments: ActiveShipmentSummary[];
  /** MOVO-284: envíos que ya tienen chat, con su contador de no leídos. */
  chatByShipment?: Record<string, { unreadCount: number }>;
  testID?: string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}) {
  if (shipments.length === 0) {
    if (isLoading) {
      return <HomeSectionSkeleton testID={`${testID}-skeleton`} cardHeight={ACTIVE_CARD_SKELETON_HEIGHT} />;
    }
    if (isError && onRetry) {
      return (
        <HomeSectionError
          testID={`${testID}-error`}
          title={title}
          message="No pudimos cargar esta sección."
          onRetry={onRetry}
        />
      );
    }
    return null;
  }

  return (
    <View testID={testID} className="mb-6 gap-2.5">
      <Text className="font-sans-medium text-caption uppercase text-fg-3">{title}</Text>
      {shipments.map((shipment) => (
        <ActiveShipmentCard
          key={shipment.id}
          shipment={shipment}
          role={role}
          chat={chatByShipment?.[shipment.id]}
          testID={`${testID}-card-${shipment.id}`}
        />
      ))}
    </View>
  );
}
