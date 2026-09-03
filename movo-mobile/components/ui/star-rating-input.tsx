import { Star } from "lucide-react-native";
import { Pressable, View } from "react-native";

export interface StarRatingInputProps {
  score: number;
  onChange?: (score: number) => void;
  readOnly?: boolean;
  size?: number;
  gap?: number;
  activeColor?: string;
  inactiveColor?: string;
  testID?: string;
}

const STARS = [1, 2, 3, 4, 5] as const;

/**
 * Control reusable de calificación por estrellas (MOVO-153 / MOVO-22).
 * Soporta modo interactivo (1..5 estrellas) y modo de solo lectura para perfiles y ofertas.
 */
export function StarRatingInput({
  score,
  onChange,
  readOnly = false,
  size = 28,
  gap = 6,
  activeColor = "#F5B93A",
  inactiveColor = "#71717A",
  testID,
}: StarRatingInputProps) {
  const emptyColor = inactiveColor;

  return (
    <View
      testID={testID ?? "star-rating-input"}
      accessibilityRole={readOnly ? "none" : "radiogroup"}
      className="flex-row items-center"
      style={{ gap }}
    >
      {STARS.map((star) => {
        const isFilled = star <= Math.round(score);
        const starColor = isFilled ? activeColor : emptyColor;

        return (
          <Pressable
            key={star}
            testID={testID ? `${testID}-star-${star}` : `star-${star}`}
            onPress={readOnly ? undefined : () => onChange?.(star)}
            disabled={readOnly}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
            accessibilityRole={readOnly ? "image" : "radio"}
            accessibilityLabel={`${star} ${star === 1 ? "estrella" : "estrellas"}`}
            accessibilityState={{ selected: star === score }}
            className="items-center justify-center active:scale-110"
          >
            <Star
              size={size}
              color={starColor}
              fill={isFilled ? activeColor : "transparent"}
              strokeWidth={1.8}
            />
          </Pressable>
        );
      })}
    </View>
  );
}
