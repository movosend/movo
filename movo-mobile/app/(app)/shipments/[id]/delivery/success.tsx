import { useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Pressable, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HandshakeConfirmationResult } from "../../../../../components/handshake/handshake-confirmation-result";
import { RatingSheet, type RatingTarget } from "../../../../../components/shipments/rating-sheet";
import { useShipment } from "../../../../../src/hooks/use-shipments";
import { useShipmentRatings } from "../../../../../src/hooks/use-ratings";
import { usePublicProfile } from "../../../../../src/hooks/use-profile";
import { useDeliveryResult } from "./_layout";

/**
 * Paso terminal del wizard de entrega (MOVO-199 AC8): reusa `HandshakeConfirmationResult`
 * tal cual (mismo componente que `pickup/success.tsx`, stage `"delivery"` ya
 * diferenciado ahí -- distingue `DELIVERED` "estamos procesando el pago" de
 * `COMPLETED` "el pago fue acreditado", sin afirmar de más sobre un cobro que
 * `FundsReleaseNotifier` todavía no ejecuta de verdad, ADR-021). Invalida el
 * detalle del envío ANTES de navegar, así el transportista lo ve ya en
 * `delivered`/`completed` sin depender de un refetch en el aire.
 *
 * El CTA principal vuelve al detalle del envío (a diferencia de pickup, que navega
 * a `/route` -- acá no hay próxima parada que trackear, la entrega es el final del
 * viaje de ese envío).
 *
 * **AC9 (acceso a calificar desde el éxito)**: CTA secundario que abre `RatingSheet`
 * (MOVO-153) directo con el receptor como target, sin reimplementar nada de la
 * lógica de calificación -- mismo componente que ya usa `ShipmentRatingsCard` en el
 * detalle del envío. `useShipment(result.shipmentId)` resuelve el `receiverId` --
 * mismo query key que ya consume `HandshakeConfirmationResult` internamente,
 * TanStack Query dedupea, sin request de más.
 */
export default function DeliverySuccessScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { result } = useDeliveryResult();
  const [ratingOpen, setRatingOpen] = useState(false);

  const { data: shipment } = useShipment(result?.shipmentId);
  const { data: ratings } = useShipmentRatings(result?.shipmentId, { enabled: !!result });
  const { data: receiverProfile } = usePublicProfile(shipment?.receiverId);

  function goToShipment() {
    void queryClient.invalidateQueries({ queryKey: ["shipments", "detail", id] });
    router.replace(`/shipments/${id}`);
  }

  if (!result) {
    // Reingreso directo a esta ruta sin haber pasado por `qr.tsx` en esta sesión (el
    // resultado no sobrevive a un cierre de la app) -- degrada a un mensaje simple
    // en vez de romper, el estado real del envío se ve en el detalle.
    return (
      <SafeAreaView className="flex-1 items-center justify-center gap-4 bg-ink-950 px-8">
        <Text testID="delivery-success-no-result" className="text-center font-sans text-body text-ink-300">
          No tenemos el detalle de esta confirmación a mano, pero podés ver el estado
          actual del envío.
        </Text>
        <Pressable
          testID="delivery-success-no-result-cta"
          onPress={goToShipment}
          className="w-full items-center justify-center rounded-lg bg-paper py-3.5 active:opacity-85"
        >
          <Text className="font-sans-semibold text-body text-ink-950">Ver envío</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const receiverUserId = shipment?.receiverId;
  const existingRating = ratings?.find((r) => r.rateeId === receiverUserId);
  const alreadyRated = !!existingRating;
  const ratingTarget: RatingTarget | null = receiverUserId
    ? {
        userId: receiverUserId,
        fullName: receiverProfile?.fullName ?? "Receptor",
        photoUrl: receiverProfile?.photoUrl ?? null,
        roleLabel: "Receptor",
        rateeRole: "receiver",
        existingRating,
      }
    : null;

  return (
    <SafeAreaView className="flex-1 bg-ink-950">
      <HandshakeConfirmationResult
        testID="delivery-success-result"
        result={result}
        onCtaPress={goToShipment}
        secondaryCtaLabel={ratingTarget ? (alreadyRated ? "Ya calificaste al receptor" : "Calificar al receptor") : undefined}
        onSecondaryCtaPress={ratingTarget ? () => setRatingOpen(true) : undefined}
      />

      <RatingSheet
        testID="delivery-success-rating-sheet"
        shipmentId={result.shipmentId}
        target={ratingTarget}
        visible={ratingOpen}
        onClose={() => setRatingOpen(false)}
        onSuccess={() => setRatingOpen(false)}
      />
    </SafeAreaView>
  );
}
