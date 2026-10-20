import { Package, Truck } from "lucide-react-native";
import { useState } from "react";
import { Pressable, Text, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, useReducedMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { TourRect } from "../../src/store/tour-store";

/** Lo que el tooltip y el modal necesitan del paso actual (prototipo de MOVO-169). */
export interface TourStepView {
  title: string;
  body: string;
  index: number;
  count: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
}

function stepLabel(index: number, count: number) {
  return `PASO ${index + 1} DE ${count}`;
}

/** Entrada del prototipo (`tipIn`, 260ms). */
function useEnteringAnimation() {
  const reduceMotion = useReducedMotion();
  return reduceMotion ? undefined : FadeIn.duration(260);
}

function primaryLabel(index: number, count: number, isModal: boolean) {
  if (index === count - 1) return "¡Entendido!";
  return isModal && index === 0 ? "Empezar" : "Siguiente";
}

/** Modal centrado de los pasos sin ancla. La card es siempre blanca, como en el prototipo:
 * va sobre el scrim oscuro, así que se lee igual en claro y en oscuro. */
export function TourModal({ title, body, index, count, onNext, onPrev, onSkip, icon }: TourStepView & { icon: "package" | "truck" }) {
  const Icon = icon === "truck" ? Truck : Package;
  const entering = useEnteringAnimation();
  return (
    <View pointerEvents="box-none" className="absolute inset-0 items-center justify-center px-8">
      <Animated.View
        entering={entering}
        testID="tour-modal"
        accessibilityViewIsModal
        className="w-full max-w-[326px] items-center gap-2.5 rounded-[26px] bg-paper px-[22px] pb-[18px] pt-[26px]"
      >
        <View className="mb-1 h-[60px] w-[60px] items-center justify-center rounded-full bg-lime-500">
          <Icon size={26} strokeWidth={1.8} color="#0A0A0B" />
        </View>
        <Text testID="tour-step-label" className="font-sans-semibold text-[11px] tracking-[1px] text-ink-500">
          {stepLabel(index, count)}
        </Text>
        <Text
          testID="tour-step-title"
          accessibilityRole="header"
          className="text-center font-sans-semibold text-[22px] leading-[28px] tracking-[-0.3px] text-ink-950"
        >
          {title}
        </Text>
        <Text testID="tour-step-body" className="text-center font-sans text-[15px] leading-[22px] text-ink-600">
          {body}
        </Text>
        <Pressable
          testID="tour-primary"
          onPress={onNext}
          accessibilityRole="button"
          className="mt-2.5 h-[50px] w-full items-center justify-center rounded-full bg-lime-500"
        >
          <Text className="font-sans-semibold text-[16px] text-ink-950">{primaryLabel(index, count, true)}</Text>
        </Pressable>
        <Pressable
          testID={index === 0 ? "tour-skip" : "tour-prev"}
          onPress={index === 0 ? onSkip : onPrev}
          accessibilityRole="button"
          className="h-10 justify-center px-3"
        >
          <Text className="font-sans-medium text-[14px] text-ink-500">{index === 0 ? "Omitir tutorial" : "Anterior"}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const SIDE_MARGIN = 20;
const GAP = 16;
const CARET_SIZE = 14;
/** Espacio de la tab bar flotante sobre el inset inferior (pill + margen + aire). */
const TAB_BAR_CLEARANCE = 80;

/**
 * Tooltip de un paso con ancla: abajo del spotlight si el ancla está en la mitad de arriba
 * de la pantalla, arriba si no. No se sale de las safe areas ni se mete debajo de la tab bar.
 */
export function TourTooltip({ title, body, index, count, onNext, onPrev, onSkip, rect }: TourStepView & { rect: TourRect }) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);
  const entering = useEnteringAnimation();
  const cardWidth = windowWidth - SIDE_MARGIN * 2;
  const below = rect.y + rect.height / 2 < windowHeight / 2;

  let top: number;
  if (below) {
    const maxBottom = windowHeight - insets.bottom - TAB_BAR_CLEARANCE;
    top = Math.min(rect.y + rect.height + GAP, maxBottom - height);
  } else {
    top = Math.max(rect.y - GAP - height, insets.top + 8);
  }
  const caretLeft = Math.max(18, Math.min(cardWidth - 32, rect.x + rect.width / 2 - SIDE_MARGIN - CARET_SIZE / 2));

  return (
    <Animated.View
      entering={entering}
      testID="tour-tooltip"
      accessibilityViewIsModal
      onLayout={(event) => setHeight(event.nativeEvent.layout.height)}
      style={{
        position: "absolute",
        left: SIDE_MARGIN,
        width: cardWidth,
        top,
        // Hasta saber su alto no se sabe dónde va; se muestra recién al medirse.
        opacity: height > 0 ? 1 : 0,
        shadowColor: "#000000",
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.35,
        shadowRadius: 16,
        elevation: 12,
      }}
      className="rounded-[20px] bg-paper px-[18px] pb-[14px] pt-[18px]"
    >
      <View
        style={{
          position: "absolute",
          left: caretLeft,
          width: CARET_SIZE,
          height: CARET_SIZE,
          borderRadius: 3,
          transform: [{ rotate: "45deg" }],
          ...(below ? { top: -6 } : { bottom: -6 }),
        }}
        className="bg-paper"
      />
      <View className="mb-2 flex-row items-center justify-between">
        <Text testID="tour-step-label" className="font-sans-semibold text-[11px] tracking-[1px] text-ink-500">
          {stepLabel(index, count)}
        </Text>
        <View className="flex-row items-center gap-1">
          {Array.from({ length: count }, (_, i) => (
            <View key={i} className={`h-1.5 rounded-full ${i === index ? "w-4 bg-ink-950" : "w-1.5 bg-ink-200"}`} />
          ))}
        </View>
      </View>
      <Text
        testID="tour-step-title"
        accessibilityRole="header"
        className="font-sans-semibold text-[18px] leading-6 tracking-[-0.2px] text-ink-950"
      >
        {title}
      </Text>
      <Text testID="tour-step-body" className="mt-1.5 font-sans text-[14.5px] leading-[21px] text-ink-600">
        {body}
      </Text>
      <View className="mt-3.5 flex-row items-center gap-2">
        <Pressable testID="tour-skip" onPress={onSkip} accessibilityRole="button" className="h-11 justify-center px-1.5">
          <Text className="font-sans-medium text-[14px] text-ink-500">Omitir</Text>
        </Pressable>
        <View className="flex-1" />
        {index > 0 ? (
          <Pressable
            testID="tour-prev"
            onPress={onPrev}
            accessibilityRole="button"
            className="h-11 justify-center rounded-full border border-ink-200 bg-paper px-4"
          >
            <Text className="font-sans-medium text-[14px] text-ink-950">Anterior</Text>
          </Pressable>
        ) : null}
        <Pressable
          testID="tour-primary"
          onPress={onNext}
          accessibilityRole="button"
          className="h-11 justify-center rounded-full bg-lime-500 px-5"
        >
          <Text className="font-sans-semibold text-[14px] text-ink-950">{primaryLabel(index, count, false)}</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}
