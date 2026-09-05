import { ApiError } from "@movo/shared/dist/errors/api-error";
import { router, useLocalSearchParams } from "expo-router";
import { ArrowUpDown, ChevronLeft, Inbox } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ChooseOfferModal } from "../../../../components/shipments/choose-offer-modal";
import { ChooseOfferSuccessModal } from "../../../../components/shipments/choose-offer-success-modal";
import { OfferCard } from "../../../../components/shipments/offer-card";
import { RejectOfferModal } from "../../../../components/shipments/reject-offer-modal";
import { ErrorBanner } from "../../../../components/ui/error-banner";
import { SkeletonBlock } from "../../../../components/ui/skeleton-block";
import type { OfferSortOption, OfferSummary } from "../../../../src/api/offers-client";
import {
  useAcceptOffer,
  useRejectOffer,
  useShipmentOffers,
} from "../../../../src/hooks/use-offers";
import { useShipment } from "../../../../src/hooks/use-shipments";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";

function OffersSkeleton() {
  return (
    <View testID="offers-skeleton" className="gap-4 px-5 pt-4">
      {[1, 2, 3].map((i) => (
        <View
          key={i}
          className="rounded-[16px] border border-border bg-bg p-4 gap-3.5"
        >
          <View className="flex-row items-center gap-3">
            <SkeletonBlock className="h-11 w-11 rounded-full" />
            <View className="flex-1 gap-1.5">
              <SkeletonBlock className="h-4 w-32 rounded-md" />
              <SkeletonBlock className="h-3 w-20 rounded-md" />
            </View>
          </View>
          <SkeletonBlock className="h-14 w-full rounded-[12px]" />
          <View className="flex-row gap-2.5 pt-1">
            <SkeletonBlock className="h-11 flex-1 rounded-[10px]" />
            <SkeletonBlock className="h-11 flex-1 rounded-[10px]" />
          </View>
        </View>
      ))}
    </View>
  );
}

/**
 * Pantalla de listado, comparación y elección de ofertas recibidas (MOVO-150 / MOVO-17).
 */
export default function ShipmentOffersScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();

  const [sort, setSort] = useState<OfferSortOption>("price");
  const [offerToAccept, setOfferToAccept] = useState<OfferSummary | null>(null);
  const [offerToReject, setOfferToReject] = useState<OfferSummary | null>(null);
  const [acceptedOfferCarrierName, setAcceptedOfferCarrierName] = useState<string | null>(null);
  const [isSuccessModalVisible, setIsSuccessModalVisible] = useState(false);
  const [acceptErrorMessage, setAcceptErrorMessage] = useState<string | null>(null);
  const [rejectErrorMessage, setRejectErrorMessage] = useState<string | null>(null);

  const {
    data: offers,
    isLoading,
    isError,
    error,
    refetch,
    isRefetching,
  } = useShipmentOffers(id, { sort });

  const { refetch: refetchShipment } = useShipment(id);

  const acceptMutation = useAcceptOffer();
  const rejectMutation = useRejectOffer();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/shipments/${id}` as never);
    }
  };

  const handleOpenCarrierProfile = (carrierId: string) => {
    router.push(`/profile/${carrierId}`);
  };

  const handlePromptAccept = (offer: OfferSummary) => {
    setAcceptErrorMessage(null);
    setOfferToAccept(offer);
  };

  const handleConfirmAccept = async () => {
    if (!offerToAccept) return;
    try {
      await acceptMutation.mutateAsync(offerToAccept.id);
      setAcceptedOfferCarrierName(offerToAccept.carrierNameAtOffer);
      setOfferToAccept(null);
      setIsSuccessModalVisible(true);
      void refetch();
      void refetchShipment();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setAcceptErrorMessage(
          "Esta oferta ya no está disponible o el envío fue asignado a otro transportista."
        );
        void refetch();
        void refetchShipment();
      } else {
        setAcceptErrorMessage(
          friendlyErrorMessage(err, "No pudimos seleccionar esta oferta. Intentá de nuevo.")
        );
      }
    }
  };

  const handlePromptReject = (offer: OfferSummary) => {
    setRejectErrorMessage(null);
    setOfferToReject(offer);
  };

  const handleConfirmReject = async () => {
    if (!offerToReject) return;
    try {
      await rejectMutation.mutateAsync(offerToReject.id);
      setOfferToReject(null);
      void refetch();
    } catch (err) {
      if (err instanceof ApiError && err.statusCode === 409) {
        setRejectErrorMessage("Esta oferta ya no se puede rechazar.");
        void refetch();
      } else {
        setRejectErrorMessage(
          friendlyErrorMessage(err, "No pudimos rechazar esta oferta. Intentá de nuevo.")
        );
      }
    }
  };

  const handleSuccessDismiss = () => {
    setIsSuccessModalVisible(false);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace(`/shipments/${id}` as never);
    }
  };

  const offerCount = offers ? offers.length : 0;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      {/* Top Navbar */}
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5 border-b border-border">
        <Pressable
          testID="offers-screen-back"
          onPress={handleBack}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute active:opacity-75"
          accessibilityRole="button"
          accessibilityLabel="Volver al detalle del envío"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>

        <View className="flex-1">
          <Text className="font-sans-semibold text-h3 text-fg">Ofertas recibidas</Text>
          <Text className="font-sans text-[12px] text-fg-3">
            {offerCount === 1 ? "1 propuesta disponible" : `${offerCount} propuestas disponibles`}
          </Text>
        </View>

        {offerCount > 0 ? (
          <View className="rounded-full bg-lime-500 px-2.5 py-0.5">
            <Text className="font-sans-semibold text-[12px] text-ink-950">{offerCount}</Text>
          </View>
        ) : null}
      </View>

      {/* Sort Control */}
      <View className="flex-row items-center justify-between px-5 py-3 border-b border-border bg-bg-sub/30">
        <View className="flex-row items-center gap-1.5">
          <ArrowUpDown size={14} color={colors.fg3} />
          <Text className="font-sans text-caption uppercase tracking-wider text-fg-3">
            Ordenar por
          </Text>
        </View>

        <View className="flex-row gap-1.5">
          <Pressable
            testID="sort-by-price"
            onPress={() => setSort("price")}
            className={`rounded-full px-3 py-1.5 ${sort === "price" ? "bg-fg" : "bg-bg-mute"
              }`}
          >
            <Text
              className={`font-sans-medium text-[12px] ${sort === "price" ? "text-bg" : "text-fg-2"
                }`}
            >
              Menor precio
            </Text>
          </Pressable>

          <Pressable
            testID="sort-by-rating"
            onPress={() => setSort("rating")}
            className={`rounded-full px-3 py-1.5 ${sort === "rating" ? "bg-fg" : "bg-bg-mute"
              }`}
          >
            <Text
              className={`font-sans-medium text-[12px] ${sort === "rating" ? "text-bg" : "text-fg-2"
                }`}
            >
              Mejor reputación
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Main Content */}
      {isLoading ? (
        <OffersSkeleton />
      ) : isError ? (
        <View className="px-5 pt-6 gap-3">
          <ErrorBanner
            testID="offers-load-error"
            message={friendlyErrorMessage(
              error,
              "No pudimos cargar las ofertas de este envío.",
              {
                AUTH_FORBIDDEN: "Esta sección solo está disponible para el emisor del envío.",
              }
            )}
          />
          <Pressable
            testID="offers-retry-btn"
            onPress={() => refetch()}
            className="self-start px-3 py-1.5 rounded-lg bg-bg-mute"
          >
            <Text className="font-sans-medium text-small text-fg">Reintentar</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-5 py-4 gap-4"
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={refetch}
              tintColor={colors.fg2}
            />
          }
        >
          {offers && offers.length === 0 ? (
            <View testID="offers-empty-state" className="items-center py-16 px-6 gap-3">
              <View className="h-16 w-16 items-center justify-center rounded-2xl bg-bg-mute mb-2">
                <Inbox size={28} color={colors.fg3} strokeWidth={1.8} />
              </View>
              <Text className="font-sans-semibold text-h3 text-fg text-center">
                Todavía no recibiste ofertas
              </Text>
              <Text className="font-sans text-small leading-5 text-fg-3 text-center max-w-[280px]">
                Los transportistas que viajen por tu ruta verán tu publicación y te enviarán sus
                propuestas aquí.
              </Text>
            </View>
          ) : (
            offers?.map((offer) => (
              <OfferCard
                key={offer.id}
                offer={offer}
                onAccept={handlePromptAccept}
                onReject={handlePromptReject}
                onViewProfile={handleOpenCarrierProfile}
                disabled={acceptMutation.isPending || rejectMutation.isPending}
                testID={`offer-card-${offer.id}`}
              />
            ))
          )}
        </ScrollView>
      )}

      {/* Choose Offer Confirmation Modal */}
      <ChooseOfferModal
        offer={offerToAccept}
        visible={!!offerToAccept}
        isPending={acceptMutation.isPending}
        errorMessage={acceptErrorMessage}
        onConfirm={handleConfirmAccept}
        onClose={() => {
          if (!acceptMutation.isPending) {
            setOfferToAccept(null);
            setAcceptErrorMessage(null);
          }
        }}
        testID="choose-offer-modal"
      />

      {/* Choose Offer Success Modal */}
      <ChooseOfferSuccessModal
        visible={isSuccessModalVisible}
        carrierName={acceptedOfferCarrierName}
        onDismiss={handleSuccessDismiss}
        testID="choose-offer-success-modal"
      />

      {/* Reject Offer Confirmation Modal */}
      <RejectOfferModal
        offer={offerToReject}
        visible={!!offerToReject}
        isPending={rejectMutation.isPending}
        errorMessage={rejectErrorMessage}
        onConfirm={handleConfirmReject}
        onClose={() => {
          if (!rejectMutation.isPending) {
            setOfferToReject(null);
            setRejectErrorMessage(null);
          }
        }}
        testID="reject-offer-modal"
      />
    </SafeAreaView>
  );
}
