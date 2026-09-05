import { router, useLocalSearchParams } from "expo-router";
import { Check, ChevronLeft, ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MutualConnectionsRow } from "../../../components/profile/mutual-connections-row";
import { ProfileActionsMenu } from "../../../components/profile/profile-actions-menu";
import { ProfileAvatar } from "../../../components/profile/profile-avatar";
import {
  ReputationCard,
  type ReputationRole,
} from "../../../components/profile/reputation-card";
import { UsageStatsGrid } from "../../../components/profile/usage-stats-grid";
import { VehicleCard } from "../../../components/profile/vehicle-card";
import { VerificationChips } from "../../../components/profile/verification-chips";
import { GridPattern } from "../../../components/ui/grid-pattern";
import { SkeletonBlock } from "../../../components/ui/skeleton-block";
import { StarRatingInput } from "../../../components/ui/star-rating-input";
import { useAuthStore } from "../../../src/store/auth-store";
import { useSharedHistory } from "../../../src/hooks/use-shipments";
import { usePublicProfile } from "../../../src/hooks/use-profile";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { formatRatingDate } from "../../../src/lib/profile-format";

const NEW_PROFILE_GUARANTEES = [
  {
    title: "Seguimiento en vivo",
    detail:
      "Quien envía como con quien recibe tiene seguimiento en tiempo real.",
  },
  {
    title: "Entrega garantizada",
    detail:
      "El envio solo se termina cuando el transportista y el remitente se encuentran y confirman la entrega.",
  },
  {
    title: "Pago retenido",
    detail: "Se cobra recién cuando se confirma la entrega.",
  },
];

function ProfileDetailSkeleton() {
  return (
    <SafeAreaView
      testID="profile-detail-skeleton"
      className="flex-1 bg-bg"
      edges={["top", "bottom"]}
    >
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <SkeletonBlock className="h-8 w-8 rounded-full" />
        <SkeletonBlock className="h-4 w-32 rounded-md" />
      </View>
      <View className="gap-4 px-5 pt-4">
        <View className="flex-row items-center gap-3.5">
          <SkeletonBlock className="h-20 w-20 rounded-full" />
          <View className="flex-1 gap-2">
            <SkeletonBlock className="h-5 w-40 rounded-md" />
            <SkeletonBlock className="h-3.5 w-28 rounded-md" />
          </View>
        </View>
        <SkeletonBlock className="h-24 w-full rounded-2xl" />
        <SkeletonBlock className="h-40 w-full rounded-2xl" />
      </View>
    </SafeAreaView>
  );
}

function Eyebrow({ children }: { children: string }) {
  return (
    <Text className="mb-2 font-sans-medium text-caption uppercase text-fg-3">
      {children}
    </Text>
  );
}

/**
 * Perfil público de otro usuario (MOVO-176) — pantalla completa, reemplaza la
 * bottom sheet chica de MOVO-154 (`PublicProfileSheet`, borrada). El prototipo de
 * Claude Design que originó este rediseño trae varias secciones que todavía no
 * tienen backend (bio, vehículo, barras de categoría, stats de uso, conexiones
 * mutuas, historial compartido, nombre de quien calificó) — cada una se oculta
 * sola si el campo correspondiente no llega en `PublicProfile` (ver MOVO-170 a
 * MOVO-175 en Linear para el contrato propuesto de cada una), así que esta
 * pantalla no se rompe hoy y va completándose sola a medida que ese backend
 * aterrice.
 *
 * Sin CTA de mensajería a propósito: ya existe MOVO-26 en el backlog, pero su
 * propio AC dice que el chat no funciona sin una transacción activa en común, y
 * esta pantalla se abre para cualquier usuario — se excluye para no contradecir
 * ese alcance ya definido.
 */
export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useThemeColors();
  const currentUserId = useAuthStore((state) => state.user?.userId);
  const { data: profile, isLoading, isError } = usePublicProfile(id);
  const { data: sharedHistory } = useSharedHistory(id);
  const [role, setRole] = useState<ReputationRole>("carrier");

  const handleBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/(tabs)/home");
  };

  if (isLoading) return <ProfileDetailSkeleton />;

  if (isError || !profile) {
    return (
      <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
        <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
          <View
            testID="profile-detail-back"
            onTouchEnd={handleBack}
            className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
          >
            <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
          </View>
        </View>
        <View className="flex-1 items-center justify-center px-8">
          <Text
            testID="profile-detail-error"
            className="text-center font-sans text-body text-fg-2"
          >
            No pudimos cargar la información de este perfil.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasCarrier = profile.transactionCounts.asCarrier > 0;
  const hasSender = profile.transactionCounts.asSender > 0;
  const isOwnProfile = !!currentUserId && currentUserId === profile.id;
  const shownComments = profile.recentRatingComments.slice(0, 10);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <View
          testID="profile-detail-back"
          onTouchEnd={handleBack}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </View>
        <Text
          className="flex-1 text-center font-sans-semibold text-h3 text-fg"
          numberOfLines={1}
        >
          {profile.fullName}
        </Text>
        {isOwnProfile ? (
          <View className="h-8 w-8" />
        ) : (
          <ProfileActionsMenu
            userId={profile.id}
            fullName={profile.fullName}
            testID="profile-detail-actions"
          />
        )}
      </View>

      <ScrollView
        testID="profile-detail-content"
        showsVerticalScrollIndicator={false}
        contentContainerClassName="px-5 pb-10 gap-5"
      >
        {/* Hero */}
        <View className="relative -mx-5 gap-3 overflow-hidden px-5 pb-4 pt-3">
          <GridPattern />
          <View className="flex-row items-center gap-3.5">
            <ProfileAvatar
              testID="profile-detail-avatar"
              fullName={profile.fullName}
              photoUrl={profile.photoUrl}
              size={80}
            />
            <View className="flex-1 gap-1">
              <Text className="font-sans-semibold text-[24px] leading-[27px] text-fg">
                {profile.fullName}
              </Text>
              {profile.isVerified ? (
                <View className="flex-row items-center gap-1.5">
                  <ShieldCheck size={13} strokeWidth={2.3} color="#2BB673" />
                  <Text className="font-sans-medium text-[12px] text-fg-2">
                    Identidad verificada
                  </Text>
                </View>
              ) : null}
              {profile.memberSince ? (
                <Text className="font-sans text-[12px] text-fg-3">
                  {profile.memberSince}
                </Text>
              ) : null}
            </View>
          </View>

          {profile.bio ? (
            <Text className="font-sans text-[14px] leading-[20px] text-fg-2">
              {profile.bio}
            </Text>
          ) : null}

          <VerificationChips
            testID="profile-detail-verifications"
            isIdentityVerified={profile.isVerified}
            isLicenseVerified={profile.badges.includes("license_verified")}
            isPhoneVerified={profile.phoneVerified}
            isEmailVerified={profile.emailVerified}
          />
        </View>

        {profile.isNewProfile ? (
          <View className="gap-3">
            <View className="overflow-hidden rounded-2xl border border-border bg-bg-sub">
              <View className="px-5 pb-5 pt-[18px]">
                <Eyebrow>Primer envío en Movo</Eyebrow>
                <Text className="mb-2.5 mt-1 font-sans-semibold text-[19px] leading-[25px] text-fg">
                  Todavía no tiene calificaciones. La identidad sí está
                  chequeada.
                </Text>
                <Text className="font-sans text-[14px] leading-[20px] text-fg-2">
                  Sin calificaciones no hay reputación para mirar. Lo que sí
                  podés mirar es esto.
                </Text>
              </View>
              {NEW_PROFILE_GUARANTEES.map((g) => (
                <View
                  key={g.title}
                  className="flex-row items-start gap-3 border-t border-border px-5 py-4"
                >
                  <View className="mt-0.5 h-6 w-6 items-center justify-center rounded-full bg-lime-500">
                    <Check size={14} strokeWidth={3} color="#0A0A0B" />
                  </View>
                  <View className="flex-1 gap-0.5">
                    <Text className="font-sans-semibold text-[15px] text-fg">
                      {g.title}
                    </Text>
                    <Text className="font-sans text-[13.5px] leading-[19px] text-fg-2">
                      {g.detail}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
            <VehicleCard
              vehicle={profile.vehicle}
              testID="profile-detail-vehicle"
            />
          </View>
        ) : (
          <View className="gap-3">
            <ReputationCard
              testID="profile-detail-reputation"
              hasCarrier={hasCarrier}
              hasSender={hasSender}
              role={hasCarrier ? role : "sender"}
              onRoleChange={setRole}
              asSender={profile.asSender}
              asCarrier={profile.asCarrier}
            />
            <UsageStatsGrid
              testID="profile-detail-usage-stats"
              usageStats={
                (role === "carrier" ? profile.asCarrier : profile.asSender)
                  .usageStats
              }
              role={hasCarrier ? role : "sender"}
            />
            <VehicleCard
              vehicle={profile.vehicle}
              testID="profile-detail-vehicle"
            />
          </View>
        )}

        <MutualConnectionsRow
          userId={profile.id}
          testID="profile-detail-mutual-connections"
        />

        {sharedHistory ? (
          <Text
            testID="profile-detail-shared-history"
            className="font-sans text-[12.5px] text-fg-2"
          >
            {sharedHistory.sharedShipmentCount === 0
              ? "Nunca enviaron nada juntos."
              : `Ya enviaste ${sharedHistory.sharedShipmentCount} paquete${sharedHistory.sharedShipmentCount === 1 ? "" : "s"} con esta persona.`}
          </Text>
        ) : null}

        {!profile.isNewProfile ? (
          <View className="gap-3">
            <Eyebrow>Lo que dicen</Eyebrow>
            {shownComments.length === 0 ? (
              <Text className="font-sans text-small text-fg-3">
                Todavía no tiene comentarios.
              </Text>
            ) : (
              <View className="gap-2.5">
                {shownComments.map((comment) => (
                  <View
                    key={comment.id}
                    testID={`profile-detail-review-${comment.id}`}
                    className="gap-2 rounded-2xl border border-border bg-bg-sub p-3.5"
                  >
                    <View className="flex-row items-center justify-between">
                      <Text className="font-sans-semibold text-[13px] text-fg">
                        {comment.raterName ?? "Un usuario de Movo"}
                      </Text>
                      <View className="flex-row items-center gap-1.5">
                        <StarRatingInput
                          score={comment.score}
                          readOnly
                          size={11}
                          gap={1}
                        />
                        <Text className="font-sans text-[11px] text-fg-3">
                          {formatRatingDate(comment.createdAt)}
                        </Text>
                      </View>
                    </View>
                    {comment.comment ? (
                      <Text className="font-sans text-[13px] leading-[18px] text-fg-2">
                        {comment.comment}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
