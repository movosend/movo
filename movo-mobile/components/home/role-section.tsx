import { Text, View } from "react-native";
import type { ActiveShipmentSummary } from "../../src/api/shipments-client";
import type { ActiveShipmentRole } from "../../src/lib/active-shipment-format";
import { ActiveShipmentCard } from "./active-shipment-card";

/**
 * Sección de envíos activos de un rol ("Estoy enviando"/"Voy a recibir", MOVO-193
 * AC1) — no se renderiza si no hay envíos (AC2), nunca un placeholder vacío.
 */
export function RoleSection({
  title,
  role,
  shipments,
  testID,
}: {
  title: string;
  role: ActiveShipmentRole;
  shipments: ActiveShipmentSummary[];
  testID?: string;
}) {
  if (shipments.length === 0) return null;

  return (
    <View testID={testID} className="mb-6 gap-2.5">
      <Text className="font-sans-medium text-caption uppercase text-fg-3">{title}</Text>
      {shipments.map((shipment) => (
        <ActiveShipmentCard
          key={shipment.id}
          shipment={shipment}
          role={role}
          testID={`${testID}-card-${shipment.id}`}
        />
      ))}
    </View>
  );
}
