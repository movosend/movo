import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Star } from "lucide-react-native";
import type { ReputationBreakdown } from "@movo/shared/dist/types/user-profile";
import { RatingSheet, type RatingTarget } from "../shipments/rating-sheet";
import { ReputationCard, type ReputationRole } from "../profile/reputation-card";

/**
 * Sección de `DevShortcutsScreen` (solo __DEV__) para probar MOVO-173 sin armar un envío
 * entregado ni depender del backend: abre el `RatingSheet` para cada rol del calificado y
 * muestra las barras de categoría de `ReputationCard` con datos ficticios.
 *
 * El envío es ficticio, así que ENVIAR la calificación falla contra el backend real (404):
 * alcanza para ver las estrellas de cada rol, no para persistir nada. Para el flujo real, ver
 * "Mis envíos" → un envío entregado → "Calificaciones".
 */
const DEV_RATING_SHIPMENT_ID = "00000000-0000-4000-8000-000000000002";

// Fotos de prueba (servicio público de avatares) para ver cómo queda el header del sheet con
// foto; sin red cae al skeleton de `AvatarImage`. Solo vive en esta pantalla de dev.
const devPhoto = (img: number) => `https://i.pravatar.cc/200?img=${img}`;

const TARGETS: { id: string; label: string; target: RatingTarget }[] = [
  {
    id: "carrier",
    label: "Calificar a un transportista",
    target: {
      userId: "dev-carrier",
      fullName: "Carlos Conductor",
      photoUrl: devPhoto(12),
      roleLabel: "Transportista",
      rateeRole: "carrier",
    },
  },
  {
    id: "sender",
    label: "Calificar a un emisor",
    target: {
      userId: "dev-sender",
      fullName: "Sofía Emisora",
      photoUrl: devPhoto(47),
      roleLabel: "Emisor",
      rateeRole: "sender",
    },
  },
  {
    id: "receiver",
    label: "Calificar a un receptor",
    target: {
      userId: "dev-receiver",
      fullName: "Rafa Receptor",
      photoUrl: devPhoto(33),
      roleLabel: "Receptor",
      rateeRole: "receiver",
    },
  },
  {
    id: "edit",
    label: "Editar calificación (categorías precargadas)",
    target: {
      userId: "dev-carrier",
      fullName: "Carlos Conductor",
      photoUrl: devPhoto(12),
      roleLabel: "Transportista",
      rateeRole: "carrier",
      existingRating: {
        id: "dev-rating",
        shipmentId: DEV_RATING_SHIPMENT_ID,
        raterId: "dev-rater",
        rateeId: "dev-carrier",
        role: "carrier",
        score: 4,
        comment: "Todo muy bien",
        punctualityScore: 5,
        careScore: 4,
        createdAt: new Date().toISOString(),
      },
    },
  },
];

const PREVIEW_AS_CARRIER: ReputationBreakdown = {
  reputationScore: 4.6,
  ratingCount: 12,
  isNewProfile: false,
  categories: [
    { key: "punctuality", label: "Puntualidad", score: 4.8 },
    { key: "care", label: "Cuidado del paquete", score: 4.4 },
    { key: "communication", label: "Comunicación", score: 3.9 },
  ],
};

const PREVIEW_AS_SENDER: ReputationBreakdown = {
  reputationScore: 4.2,
  ratingCount: 8,
  isNewProfile: false,
  categories: [
    { key: "punctuality", label: "Puntualidad", score: 4.5 },
    { key: "communication", label: "Comunicación", score: 4.1 },
  ],
};

export function DevRatingSection() {
  const [target, setTarget] = useState<RatingTarget | null>(null);
  const [previewRole, setPreviewRole] = useState<ReputationRole>("carrier");

  return (
    <View className="mb-6 rounded-[16px] border border-border bg-bg-sub p-4">
      <View className="mb-3 flex-row items-center gap-2">
        <View className="h-8 w-8 items-center justify-center rounded-full bg-amber-500/15">
          <Star size={16} color="#F59E0B" />
        </View>
        <View className="flex-1">
          <Text className="font-sans-semibold text-[15px] text-fg">
            Calificación por categorías (MOVO-173)
          </Text>
          <Text className="font-sans text-[11px] text-fg-3">
            Sheet por rol del calificado y barras del perfil
          </Text>
        </View>
      </View>

      <View className="gap-2">
        {TARGETS.map(({ id, label, target: t }) => (
          <Pressable
            key={id}
            testID={`dev-rating-${id}-btn`}
            onPress={() => setTarget(t)}
            className="flex-row items-center justify-between rounded-[12px] border border-border bg-bg px-4 py-3"
          >
            <Text className="flex-1 pr-2 font-sans-medium text-[13px] text-fg">{label}</Text>
            <Text className="font-sans text-[12px] text-lime-500">Abrir →</Text>
          </Pressable>
        ))}
      </View>

      <Text className="mb-2 mt-4 font-sans-medium text-[12px] text-fg-3">
        Vista previa de las barras en el perfil (datos ficticios)
      </Text>
      <ReputationCard
        testID="dev-rating-reputation-preview"
        hasCarrier
        hasSender
        role={previewRole}
        onRoleChange={setPreviewRole}
        asCarrier={PREVIEW_AS_CARRIER}
        asSender={PREVIEW_AS_SENDER}
      />

      <Text className="mt-3 text-center font-sans text-[11px] text-fg-3">
        💡 El envío del sheet es ficticio: al enviar la calificación el backend responde error. Para el
        flujo real: Mis envíos → envío entregado → Calificaciones.
      </Text>

      <RatingSheet
        testID="dev-rating-sheet"
        shipmentId={DEV_RATING_SHIPMENT_ID}
        target={target}
        visible={target !== null}
        onClose={() => setTarget(null)}
      />
    </View>
  );
}
