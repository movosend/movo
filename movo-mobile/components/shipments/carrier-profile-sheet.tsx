import { useRef } from "react";
import { X } from "lucide-react-native";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import { ProfileAvatar } from "../profile/profile-avatar";
import { ProfileBadges } from "../profile/profile-badges";
import { ProfileStatsRow } from "../profile/profile-stats-row";
import { ProfileVerifiedBadge } from "../profile/profile-verified-badge";
import { SkeletonBlock } from "../ui/skeleton-block";
import { usePublicProfile } from "../../src/hooks/use-profile";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export interface CarrierProfileSheetProps {
  carrierId: string | null;
  visible: boolean;
  onClose: () => void;
  testID?: string;
}

export function CarrierProfileSheet({
  carrierId,
  visible,
  onClose,
  testID,
}: CarrierProfileSheetProps) {
  const colors = useThemeColors();
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);

  const lastCarrierIdRef = useRef<string | null>(carrierId);
  if (carrierId) {
    lastCarrierIdRef.current = carrierId;
  }
  const effectiveCarrierId = carrierId ?? lastCarrierIdRef.current;
  const { data: profile, isLoading, isError } = usePublicProfile(effectiveCarrierId ?? undefined);

  return (
    <Modal
      visible={isMounted}
      animationType="none"
      transparent
      onRequestClose={onClose}
      testID={testID ?? "carrier-profile-sheet-modal"}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
        <View className="flex-1">
          {/* Overlay fade */}
          <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
            <Pressable
              testID={testID ? `${testID}-backdrop` : "carrier-profile-sheet-backdrop"}
              onPress={onClose}
              className="flex-1 bg-black/50"
            />
          </Animated.View>

          {/* Sheet container */}
          <View pointerEvents="box-none" className="flex-1 justify-end">
            <Animated.View
              style={sheetStyle}
              className="rounded-t-[24px] border-t border-border bg-bg px-5 pt-4"
            >
              <SafeAreaView edges={["bottom"]} className="gap-5">
                {/* Header */}
                <View className="flex-row items-center justify-between">
                  <Text className="font-sans-semibold text-h3 text-fg">Perfil del transportista</Text>
                  <Pressable
                    testID={testID ? `${testID}-close` : "carrier-profile-sheet-close"}
                    onPress={onClose}
                    className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
                  >
                    <X size={18} color={colors.fg2} strokeWidth={2} />
                  </Pressable>
                </View>

                {isLoading ? (
                  <View testID="carrier-profile-loading" className="gap-4 py-4">
                    <View className="flex-row items-center gap-3">
                      <SkeletonBlock className="h-14 w-14 rounded-full" />
                      <View className="flex-1 gap-2">
                        <SkeletonBlock className="h-4 w-36 rounded-md" />
                        <SkeletonBlock className="h-3 w-24 rounded-md" />
                      </View>
                    </View>
                    <SkeletonBlock className="h-24 w-full rounded-2xl" />
                  </View>
                ) : isError || !profile ? (
                  <View testID="carrier-profile-error" className="py-6 items-center">
                    <Text className="font-sans text-small text-fg-3">
                      No pudimos cargar la información de este transportista.
                    </Text>
                  </View>
                ) : (
                  <View testID="carrier-profile-content" className="gap-4 pb-2">
                    {/* User Header */}
                    <View className="flex-row items-center gap-3.5">
                      <ProfileAvatar
                        fullName={profile.fullName}
                        photoUrl={profile.photoUrl}
                        size={56}
                        testID="carrier-profile-avatar"
                      />
                      <View className="flex-1">
                        <View className="flex-row items-center gap-1.5">
                          <Text testID="carrier-profile-name" className="font-sans-semibold text-[17px] text-fg">
                            {profile.fullName}
                          </Text>
                          {profile.isVerified ? <ProfileVerifiedBadge /> : null}
                        </View>
                        <ProfileBadges badges={profile.badges} testID="carrier-profile-badges" />
                      </View>
                    </View>

                    {/* Stats */}
                    <ProfileStatsRow
                      transactionCounts={profile.transactionCounts}
                      reputationScore={profile.reputationScore}
                      testID="carrier-profile-stats"
                    />
                  </View>
                )}
              </SafeAreaView>
            </Animated.View>
          </View>
        </View>
      </SafeAreaProvider>
    </Modal>
  );
}
