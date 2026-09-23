import { router, useNavigation } from "expo-router";
import { CheckCircle2, ChevronLeft, FileText, ShieldCheck, TriangleAlert, type LucideIcon } from "lucide-react-native";
import { useEffect, useLayoutEffect, useState } from "react";
import { BackHandler, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LegalDocumentSheet } from "../../../../components/legal/legal-document-sheet";
import { useMyProfile } from "../../../../src/hooks/use-profile";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import {
  getTermsAcceptanceState,
  getPrivacyAcceptanceState,
  legalAcceptanceMeta,
  type LegalDocumentAcceptanceState,
  type LegalDocumentKind,
} from "../../../../src/lib/legal-acceptance";

/**
 * Hub "Legal" (MOVO-224/228), rediseñado en MOVO-229 sobre el prototipo de Claude
 * Design "Rediseño página Legal con estados de firma": cada documento es una
 * tarjeta con ícono, insignia de estado (Al día / Pendiente / Nueva versión), la
 * firma electrónica real (fecha + versión) y un botón que abre el sheet de lectura
 * (`legal-document-sheet.tsx`) en vez de navegar a una pantalla propia.
 * En MOVO-244: si hay documentos pendientes, la pantalla es bloqueante (no permite volver atrás).
 * Bloquea las tres vías de salida por gesto/hardware: `BackHandler` (botón físico de
 * Android) + `gestureEnabled: false` (swipe-back nativo de iOS, y el gesto de Android
 * en versiones que lo soportan) vía `useNavigation().setOptions` — solo `BackHandler`
 * dejaba el swipe-back de iOS completamente sin bloquear (bug de review, MOVO-244 PR
 * #184), la única de las tres plataformas donde esta pantalla en realidad se abría.
 */
export default function LegalHubScreen() {
  const colors = useThemeColors();
  const navigation = useNavigation();
  const { data: profile } = useMyProfile();
  const [openDoc, setOpenDoc] = useState<LegalDocumentKind | null>(null);

  const terms = getTermsAcceptanceState(profile);
  const privacy = getPrivacyAcceptanceState(profile);
  const isBlocking = terms.status !== "up_to_date" || privacy.status !== "up_to_date";

  useEffect(() => {
    if (!isBlocking) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => true);
    return () => sub.remove();
  }, [isBlocking]);

  useLayoutEffect(() => {
    navigation.setOptions({ gestureEnabled: !isBlocking });
  }, [navigation, isBlocking]);

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        {!isBlocking ? (
          <Pressable
            testID="legal-hub-back"
            onPress={() => router.back()}
            className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
          >
            <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
          </Pressable>
        ) : (
          <View className="h-8 w-8" />
        )}
        <Text className="font-sans-semibold text-h3 text-fg">Legal</Text>
      </View>

      <Text className="px-5 pb-4 font-sans text-[13px] text-fg-3">
        Los documentos que rigen el uso de Movo y el tratamiento de tus datos. Cada
        aceptación queda registrada con fecha y versión.
      </Text>

      <ScrollView
        testID="legal-hub-content"
        contentContainerClassName="px-5 pb-10"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-3">
          <LegalDocumentCard
            label="Términos y Condiciones de Uso"
            Icon={FileText}
            state={terms}
            onPress={() => setOpenDoc("terms")}
          />
          <LegalDocumentCard
            label="Política de Privacidad"
            Icon={ShieldCheck}
            state={privacy}
            onPress={() => setOpenDoc("privacy")}
          />
        </View>

        <Text className="mt-5 font-sans text-[13px] leading-[19px] text-fg-3">
          Tu aceptación se guarda como firma electrónica, con fecha y versión. Si
          publicamos una versión nueva, te la vamos a pedir de nuevo.
        </Text>
      </ScrollView>

      <LegalDocumentSheet
        visible={openDoc !== null}
        initialKind={openDoc ?? "terms"}
        profile={profile}
        onClose={() => setOpenDoc(null)}
      />
    </SafeAreaView>
  );
}

function LegalDocumentCard({
  label,
  Icon,
  state,
  onPress,
}: {
  label: string;
  Icon: LucideIcon;
  state: LegalDocumentAcceptanceState;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  const meta = legalAcceptanceMeta(state);
  const badgeClass = meta.badgeTone === "success" ? "bg-success-100" : "bg-warning-100";
  const badgeTextClass = meta.badgeTone === "success" ? "text-success-700" : "text-warning-700";
  const BadgeIcon = meta.badgeTone === "success" ? CheckCircle2 : TriangleAlert;
  const badgeIconColor = meta.badgeTone === "success" ? "#1C7E4E" : "#9A6E12";
  const signatureClass = meta.signatureTone === "warning" ? "text-warning-700" : "text-fg-3";

  return (
    <View
      testID={`legal-document-card-${label === "Política de Privacidad" ? "privacy" : "terms"}`}
      className="rounded-[10px] border border-border bg-bg-sub px-4 py-4"
    >
      <View className="flex-row items-start gap-3">
        <View className="h-[38px] w-[38px] items-center justify-center rounded-full border border-border bg-bg">
          <Icon size={17} strokeWidth={1.6} color={colors.fg1} />
        </View>
        <Text className="flex-1 pt-1.5 font-sans-medium text-[16px] text-fg" numberOfLines={2}>
          {label}
        </Text>
        <View className={`flex-row items-center gap-1 rounded-full px-2.5 py-1 ${badgeClass}`}>
          <BadgeIcon size={11} color={badgeIconColor} strokeWidth={2.2} />
          <Text className={`font-sans-semibold text-[11.5px] ${badgeTextClass}`}>{meta.badgeLabel}</Text>
        </View>
      </View>

      <Text className={`mt-3 font-sans text-[13px] leading-[19px] ${signatureClass}`}>{meta.signatureText}</Text>

      {meta.cardCtaFilled ? (
        <Pressable
          testID={`legal-document-card-cta-${label === "Política de Privacidad" ? "privacy" : "terms"}`}
          onPress={onPress}
          className="mt-3.5 w-full items-center justify-center rounded-lg bg-fg py-3"
        >
          <Text className="font-sans-semibold text-[14.5px] text-bg">{meta.cardCtaLabel}</Text>
        </Pressable>
      ) : (
        <Pressable
          testID={`legal-document-card-cta-${label === "Política de Privacidad" ? "privacy" : "terms"}`}
          onPress={onPress}
          className="mt-3.5 w-full items-center justify-center rounded-lg border border-border bg-bg py-3"
        >
          <Text className="font-sans-semibold text-[14.5px] text-fg">{meta.cardCtaLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}
