import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react-native";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { ReputationCommentCard } from "../../../components/profile/reputation-comment-card";
import { ProfileSkeleton } from "../../../components/profile/profile-skeleton";
import { useAuthStore } from "../../../src/store/auth-store";
import { usePublicProfile, useUserRatings } from "../../../src/hooks/use-profile";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { RatingsSearchField } from "../../../components/profile/ratings-search-field";
import { filterRatingsByRaterName, formatRatingCount, formatReputationScore } from "../../../src/lib/profile-format";
import { StarRatingInput } from "../../../components/ui/star-rating-input";

/**
 * "Ver todas" de la card de reputación del perfil propio (MOVO-154, rediseño
 * post-feedback) — destino explícito para no acumular comentarios en un carrusel sin
 * límite visual. Reusa `usePublicProfile(myId)` con la MISMA query key que ya pobló
 * `app/(app)/(tabs)/profile.tsx`, así que no dispara un segundo request (TanStack
 * Query dedupea).
 *
 * El perfil trae como mucho las últimas 10: esta pantalla las muestra al instante y pagina el resto con
 * `GET /users/:id/ratings` (MOVO-170). Muestra TODAS, de cualquier rol, sin importar la pestaña desde la que se abrió (MOVO-354).
 */
const MAX_SEARCH_PAGES = 10;

export default function ProfileRatingsScreen() {
  const colors = useThemeColors();
  const myId = useAuthStore((state) => state.user?.userId);
  const { data: profile, isLoading } = usePublicProfile(myId);
  const ratings = useUserRatings(myId);
  // Mientras llega la primera página, las que ya trajo el perfil.
  const cachedComments = profile?.recentRatingComments ?? [];
  const comments = ratings.data ? ratings.data.pages.flatMap((page) => page.items) : cachedComments;

  // Buscador por nombre (MOVO-354): filtra en el cliente, así que mientras hay búsqueda se traen las páginas que faltan.
  const [search, setSearch] = useState("");
  const searching = search.trim().length > 0;
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = ratings;
  // Tope de páginas que la búsqueda trae sola (cada una cuesta una consulta de envíos): pasado eso, el resto se pide a mano.
  const searchCapReached = (ratings.data?.pages.length ?? 0) >= MAX_SEARCH_PAGES;
  useEffect(() => {
    if (searching && hasNextPage && !searchCapReached && !isFetchingNextPage && !isFetchNextPageError) {
      void fetchNextPage();
    }
  }, [searching, hasNextPage, searchCapReached, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  // Buscando de verdad solo mientras todavía se trae sola la siguiente página (sin error ni tope).
  const autoSearching = searching && hasNextPage && !searchCapReached && !isFetchNextPageError;
  // El botón se oculta mientras la búsqueda avanza sola; con error o tope vuelve, para reintentar o pedir más.
  const showMoreButton = hasNextPage && (!searching || isFetchNextPageError || searchCapReached);
  const visibleComments = filterRatingsByRaterName(comments, search);
  const summary = profile;

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/profile");
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <View
          testID="profile-ratings-back"
          onTouchEnd={handleBack}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </View>
        <Text className="font-sans-semibold text-h3 text-fg">Tus calificaciones</Text>
      </View>

      {isLoading || !profile || !summary ? (
        <ProfileSkeleton testID="profile-ratings-skeleton" />
      ) : (
        <ScrollView
          testID="profile-ratings-content"
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerClassName="px-5 pb-10 gap-3"
        >
          <View className="mb-2 flex-row items-center gap-3">
            <Text className="font-sans-semibold text-[30px] leading-[30px] text-fg">
              {formatReputationScore(summary.reputationScore, summary.isNewProfile)}
            </Text>
            <View className="gap-1">
              <StarRatingInput score={summary.reputationScore ?? 0} readOnly size={13} gap={2} />
              {!summary.isNewProfile ? (
                <Text className="font-sans text-caption text-fg-3">
                  {formatRatingCount(summary.ratingCount)} en total
                </Text>
              ) : null}
            </View>
          </View>

          {comments.length > 0 ? (
            <RatingsSearchField value={search} onChangeText={setSearch} testID="profile-ratings-search" />
          ) : null}

          {comments.length === 0 ? (
            <Text testID="profile-ratings-empty" className="font-sans text-small text-fg-3">
              Todavía no tenés calificaciones.
            </Text>
          ) : visibleComments.length === 0 ? (
            <Text testID="profile-ratings-no-match" className="py-4 text-center font-sans text-small text-fg-3">
              {autoSearching
                ? "Buscando…"
                : hasNextPage
                  ? `Ninguna coincidencia entre las calificaciones cargadas. Cargá más para seguir buscando.`
                  : `Ninguna calificación coincide con "${search.trim()}"`}
            </Text>
          ) : (
            visibleComments.map((comment) => (
              <ReputationCommentCard
                key={comment.id}
                comment={comment}
                variant="list"
                testID={`profile-ratings-comment-${comment.id}`}
              />
            ))
          )}
          {showMoreButton ? (
            <Pressable
              testID="profile-ratings-more"
              accessibilityRole="button"
              disabled={ratings.isFetchingNextPage}
              onPress={() => void ratings.fetchNextPage()}
              className="mt-1 flex-row items-center justify-center gap-2 py-3 active:opacity-75"
            >
              {ratings.isFetchingNextPage ? <ActivityIndicator size="small" color={colors.fg1} /> : null}
              <Text className="font-sans-medium text-[14px] text-fg">
                {ratings.isFetchNextPageError ? "Reintentar" : ratings.isFetchingNextPage ? "Cargando…" : "Cargar más"}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
