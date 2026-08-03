import { Link } from "expo-router";
import { ArrowRight } from "lucide-react-native";
import { Image, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { DotPattern } from "../components/ui/dot-pattern";

export default function WelcomeScreen() {
  return (
    <SafeAreaView className="flex-1 bg-paper" edges={["top", "bottom"]}>
      <DotPattern />
      <View className="flex-1 justify-center px-6 pt-8">
        <Image
          source={require("../assets/movo_logo_full.png")}
          className="mb-5 h-11 aspect-[7369/2693]"
          resizeMode="contain"
          accessibilityLabel="Movo"
        />
        <Text className="mb-4 font-sans-semibold text-[28px] leading-[34px] tracking-[-0.3px] text-ink-950">
          La red logística pensada{" "}
          <Text className="font-sans-semibold text-[28px] leading-[34px] tracking-[-0.3px] text-ink-700">
            para personas
          </Text>
          .
        </Text>
        <Text className="max-w-[290px] font-sans text-body text-fg-2">
          Movo conecta tu paquete con personas que hacen ese camino todos los
          días. Sin sucursales, sin esperas.
        </Text>
      </View>

      <View className="gap-2.5 px-6 pb-6">
        <Link href="/register" asChild>
          <Pressable
            className="w-full flex-row items-center justify-center gap-2 rounded-lg bg-lime-500 py-4"
            testID="welcome-go-register"
          >
            <Text className="font-sans-semibold text-body text-ink-950">
              Soy nuevo
            </Text>
            <ArrowRight size={16} color="#0A0A0B" strokeWidth={2} />
          </Pressable>
        </Link>
        <Link href="/login" asChild>
          <Pressable
            className="w-full items-center justify-center rounded-lg border border-border-strong py-4"
            testID="welcome-go-login"
          >
            <Text className="font-sans-semibold text-body text-ink-950">
              Ya tengo cuenta
            </Text>
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  );
}
