import { Image, Text, View } from "react-native";
import { brandInitials } from "../../src/data/vehicle-catalog";
import { getBrandIconSource } from "../../src/lib/vehicle-brand-icons";

interface BrandAvatarProps {
  brand: string;
  size?: number;
  testID?: string;
  /** Fondo del círculo de iniciales (default: `bg-ink-100` del mockup). */
  bgClassName?: string;
}

/**
 * Círculo de marca — logo real si `vehicle-brand-icons.ts` tiene uno cargado,
 * iniciales (mismo lenguaje del mockup) si no. Nunca rompe por un logo
 * faltante: la ausencia de entrada en el mapa es el caso esperado hoy.
 */
export function BrandAvatar({ brand, size = 34, testID, bgClassName = "bg-ink-100" }: BrandAvatarProps) {
  const iconSource = getBrandIconSource(brand);

  return (
    <View
      testID={testID}
      className={`items-center justify-center overflow-hidden rounded-full ${bgClassName}`}
      style={{ width: size, height: size }}
    >
      {iconSource ? (
        <Image
          source={iconSource}
          resizeMode="contain"
          style={{ width: size * 0.72, height: size * 0.72 }}
        />
      ) : (
        <Text className="font-mono-semibold text-ink-600" style={{ fontSize: size * 0.33 }}>
          {brandInitials(brand)}
        </Text>
      )}
    </View>
  );
}
