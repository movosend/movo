import { useEffect } from "react";
import { Text, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import type { MutualConnections } from "@movo/shared/dist/types/user-profile";
import { useMutualConnections } from "../../src/hooks/use-profile";
import { useThemeColors } from "../../src/hooks/use-theme-colors";

/** Diámetros de los anillos, del más externo al más interno (el núcleo mide `CORE_SIZE`). */
const RING_SIZES = [96, 76, 58] as const;
/** Opacidad (hex de 2 dígitos) de cada anillo: más tenue hacia afuera. */
const RING_ALPHA = ["29", "52", "8C"] as const;
const CORE_SIZE = 44;
const MEDALLION_SIZE = RING_SIZES[0];
/** Signal Lime del manual de marca — solo el núcleo (ver `MutualConnectionsSummary`). */
const LIME = "#C6F24A";
const INK = "#0A0A0B";
/** Ease-out por defecto del manual de marca (`cubic-bezier(0.22, 1, 0.36, 1)`), sin rebote. */
const EASE_OUT = Easing.bezier(0.22, 1, 0.36, 1);

export interface MutualConnectionsRowProps {
  userId: string;
  testID?: string;
}

/**
 * "Ya hizo envíos con N personas que vos también conocés" (MOVO-174) — se resuelve solo
 * (fetch propio), oculta si el conteo es 0 o el hook todavía no tiene datos. Decisión de
 * privacidad: el backend manda `sampleFirstNames` siempre vacío, así que en la práctica el copy
 * es siempre el del conteo, sin nombrar a nadie; la variante con nombres queda soportada por si
 * esa decisión cambia.
 */
export function MutualConnectionsRow({ userId, testID }: MutualConnectionsRowProps) {
  const { data } = useMutualConnections(userId);

  if (!data) return null;
  return <MutualConnectionsSummary connections={data} testID={testID} />;
}

/** Un elemento del medallón: aparece con fade + leve escala, del centro hacia afuera (200ms, sin rebote). */
function useEntrance(order: number) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(order * 70, withTiming(1, { duration: 200, easing: EASE_OUT }));
    // `progress` es una referencia estable en runtime real (mismo criterio que
    // `use-sheet-animation.ts`); el efecto corre una vez, al montarse el elemento.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.8 + 0.2 * progress.value }],
  }));
}

function Ring({
  size,
  color,
  order,
  testID,
}: {
  size: number;
  color: string;
  order: number;
  testID: string;
}) {
  const style = useEntrance(order);
  return (
    <Animated.View
      testID={testID}
      style={[
        {
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: color,
        },
        style,
      ]}
    />
  );
}

/** Lo que muestra el núcleo: el conteo, o "99+" si no entra. */
function coreLabel(total: number): string {
  return total > 99 ? "99+" : String(total);
}

/**
 * Parte visual de la fila, sin fetch: recibe los datos ya resueltos. Separada de
 * `MutualConnectionsRow` para poder mostrarla con datos de prueba en los atajos de
 * desarrollo (`DevMutualConnectionsSection`) sin depender del backend. Oculta con 0.
 *
 * Diseño (manual de marca, opción "Anillos" elegida con el usuario): sin card, un medallón de
 * anillos concéntricos junto al copy. Los anillos son las "capas de confianza" del símbolo de la
 * marca: se suman hacia el centro según el conteo (1, 2 o 3) y el núcleo lleva el número en mono.
 * Nunca fotos ni iniciales de terceros (decisión de privacidad de MOVO-174, solo el conteo).
 *
 * **Lima en el núcleo, por pedido explícito del usuario**: el manual reserva el lima para estados
 * activos/en vivo y lo prohíbe como decoración; acá es un acento deliberado, con texto ink sobre
 * lime (combinación permitida). Si se revisa contra el manual, es un solo cambio (`LIME`).
 */
export function MutualConnectionsSummary({
  connections,
  testID,
}: {
  connections: MutualConnections;
  testID?: string;
}) {
  const colors = useThemeColors();
  const coreStyle = useEntrance(0);

  if (connections.totalCount === 0) return null;

  const total = connections.totalCount;
  const ringCount = Math.min(total, RING_SIZES.length);
  // 1 conexión = solo el anillo más interno; se suman hacia afuera hasta 3.
  const firstRing = RING_SIZES.length - ringCount;
  const id = testID ?? "mutual-connections";

  const plural = (n: number) => `persona${n === 1 ? "" : "s"}`;
  const [firstSample] = connections.sampleFirstNames;

  return (
    <View testID={testID} className="flex-row items-center gap-[18px]">
      {/* Gráfico decorativo: el copy de al lado es lo que leen los lectores de pantalla. */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ width: MEDALLION_SIZE, height: MEDALLION_SIZE }}
        className="items-center justify-center"
      >
        {RING_SIZES.map((size, i) =>
          i < firstRing ? null : (
            <Ring
              key={size}
              size={size}
              color={`${colors.fg1}${RING_ALPHA[i]}`}
              order={RING_SIZES.length - i}
              testID={`${id}-ring-${i - firstRing}`}
            />
          ),
        )}
        <Animated.View
          style={[
            {
              width: CORE_SIZE,
              height: CORE_SIZE,
              borderRadius: CORE_SIZE / 2,
              backgroundColor: LIME,
              alignItems: "center",
              justifyContent: "center",
            },
            coreStyle,
          ]}
          testID={`${id}-core`}
        >
          <Text
            testID={`${id}-count`}
            style={{ color: INK, fontSize: total > 99 ? 14 : 20 }}
            className="font-mono-semibold"
          >
            {coreLabel(total)}
          </Text>
        </Animated.View>
      </View>

      <View className="min-w-0 flex-1 gap-1.5">
        <Text className="font-sans-medium text-[11px] uppercase tracking-[0.08em] text-fg-3">
          En común
        </Text>
        <Text className="font-sans text-[14px] leading-5 text-fg-2">
          {firstSample && total > 1
            ? `Ya hizo envíos con ${firstSample} y ${total - 1} ${plural(total - 1)} más que vos también conocés.`
            : firstSample
              ? `Ya hizo envíos con ${firstSample}, a quien vos también conocés.`
              : (
                <>
                  Ya hizo envíos con{" "}
                  <Text className="font-sans-semibold text-fg">
                    {total} {plural(total)}
                  </Text>{" "}
                  que vos también conocés.
                </>
              )}
        </Text>
      </View>
    </View>
  );
}
