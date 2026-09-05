import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import { X } from "lucide-react-native";
import { ErrorBanner } from "../ui/error-banner";
import { StarRatingInput } from "../ui/star-rating-input";
import type { Rating } from "../../src/api/ratings-client";
import { useCreateRating, useUpdateRating } from "../../src/hooks/use-ratings";
import { useSheetAnimation } from "../../src/hooks/use-sheet-animation";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../src/lib/error-messages";

const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

export interface RatingTarget {
  userId: string;
  fullName: string;
  roleLabel: string;
  existingRating?: Rating;
}

export interface RatingSheetProps {
  shipmentId: string;
  target: RatingTarget | null;
  visible: boolean;
  onClose: () => void;
  onSuccess?: (rating: Rating) => void;
  testID?: string;
}

const SCORE_LABELS: Record<number, string> = {
  1: "Mala experiencia",
  2: "Regular",
  3: "Buena",
  4: "Muy buena",
  5: "Excelente",
};

/**
 * Bottom Sheet interactivo para calificar a una contraparte post-entrega o editar
 * una calificación existente dentro de la ventana de 72hs (MOVO-153 / MOVO-22 / MOVO-146).
 */
export function RatingSheet({
  shipmentId,
  target,
  visible,
  onClose,
  onSuccess,
  testID,
}: RatingSheetProps) {
  const colors = useThemeColors();
  const { isMounted, backdropStyle, sheetStyle } = useSheetAnimation(visible);

  const lastTargetRef = useRef<RatingTarget | null>(target);
  if (target) {
    lastTargetRef.current = target;
  }
  const effectiveTarget = target ?? lastTargetRef.current;

  const isEditing = !!effectiveTarget?.existingRating;

  const [score, setScore] = useState<number>(effectiveTarget?.existingRating?.score ?? 0);
  const [comment, setComment] = useState<string>(effectiveTarget?.existingRating?.comment ?? "");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sincronizar estado cuando cambia el target o se abre el sheet
  useEffect(() => {
    if (visible && target) {
      setScore(target.existingRating?.score ?? 0);
      setComment(target.existingRating?.comment ?? "");
      setErrorMessage(null);
    }
  }, [visible, target]);

  const createMutation = useCreateRating(shipmentId);
  const updateMutation = useUpdateRating(shipmentId);
  const isPending = createMutation.isPending || updateMutation.isPending;

  const handleClose = () => {
    Keyboard.dismiss();
    if (!isPending) {
      onClose();
    }
  };

  const handleSubmit = async () => {
    if (score < 1 || score > 5 || !effectiveTarget) {
      return;
    }
    setErrorMessage(null);
    Keyboard.dismiss();

    const trimmedComment = comment.trim() || undefined;

    try {
      if (isEditing) {
        const updated = await updateMutation.mutateAsync({
          rateeId: effectiveTarget.userId,
          input: { score, comment: trimmedComment },
        });
        onSuccess?.(updated);
        onClose();
      } else {
        const created = await createMutation.mutateAsync({
          rateeId: effectiveTarget.userId,
          score,
          comment: trimmedComment ?? undefined,
        });
        onSuccess?.(created);
        onClose();
      }
    } catch (err) {
      setErrorMessage(
        friendlyErrorMessage(err, "No pudimos enviar tu calificación. Intentá de nuevo.")
      );
    }
  };

  if (!isMounted || !effectiveTarget) return null;

  return (
    <Modal
      visible={isMounted}
      animationType="none"
      transparent
      onRequestClose={handleClose}
      testID={testID ?? "rating-sheet-modal"}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          className="flex-1"
        >
          <View className="flex-1">
            {/* Overlay fade */}
            <Animated.View style={[StyleSheet.absoluteFill, backdropStyle]}>
              <Pressable
                testID={testID ? `${testID}-backdrop` : "rating-sheet-backdrop"}
                onPress={handleClose}
                className="flex-1 bg-black/50"
              />
            </Animated.View>

            {/* Sheet container */}
            <View pointerEvents="box-none" className="flex-1 justify-end">
              <Animated.View
                style={sheetStyle}
                className="max-h-[90%] rounded-t-[24px] border-t border-border bg-bg px-5 pt-4"
              >
                <SafeAreaView edges={["bottom"]}>
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerClassName="gap-5 pb-4"
                    showsVerticalScrollIndicator={false}
                    bounces={false}
                  >
                    {/* Header */}
                    <View className="flex-row items-center justify-between">
                      <View className="flex-1 pr-3">
                        <Text
                          testID={testID ? `${testID}-title` : "rating-sheet-title"}
                          className="font-sans-semibold text-h3 text-fg"
                        >
                          {isEditing ? "Editar calificación" : "Calificar contraparte"}
                        </Text>
                        <Text
                          testID={testID ? `${testID}-subtitle` : "rating-sheet-subtitle"}
                          className="font-sans text-small text-fg-2 mt-0.5"
                        >
                          {effectiveTarget.fullName} · {effectiveTarget.roleLabel}
                        </Text>
                      </View>
                      <Pressable
                        testID={testID ? `${testID}-close` : "rating-sheet-close"}
                        onPress={handleClose}
                        className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
                      >
                        <X size={18} color={colors.fg2} strokeWidth={2} />
                      </Pressable>
                    </View>

                    {errorMessage ? (
                      <ErrorBanner testID={testID ? `${testID}-error` : "rating-sheet-error"} message={errorMessage} />
                    ) : null}

                    {/* Star rating selector */}
                    <View className="items-center py-2 gap-2">
                      <StarRatingInput
                        score={score}
                        onChange={setScore}
                        size={36}
                        gap={10}
                        testID={testID ? `${testID}-stars` : "rating-sheet-stars"}
                      />
                      <Text
                        testID={testID ? `${testID}-score-label` : "rating-sheet-score-label"}
                        className="font-sans-medium text-caption text-fg-2"
                      >
                        {score > 0 ? SCORE_LABELS[score] : "Tocá una estrella para calificar"}
                      </Text>
                    </View>

                    {/* Comment text area */}
                    <View className="gap-1.5">
                      <View className="flex-row items-center justify-between">
                        <Text className="font-sans-medium text-caption text-fg-3">
                          Comentario (opcional)
                        </Text>
                        <Pressable onPress={() => Keyboard.dismiss()} hitSlop={8}>
                          <Text className="font-sans-medium text-caption text-fg">
                            Listo
                          </Text>
                        </Pressable>
                      </View>
                      <TextInput
                        testID={testID ? `${testID}-comment-input` : "rating-sheet-comment-input"}
                        value={comment}
                        onChangeText={setComment}
                        placeholder="Contá cómo fue la experiencia..."
                        placeholderTextColor={colors.fg3}
                        multiline
                        numberOfLines={3}
                        maxLength={500}
                        returnKeyType="done"
                        blurOnSubmit={true}
                        onSubmitEditing={() => Keyboard.dismiss()}
                        className="rounded-xl border border-border bg-bg-mute px-3.5 py-3 font-sans text-small text-fg leading-5"
                        style={{ minHeight: 84, textAlignVertical: "top" }}
                      />
                      <Text className="self-end font-sans text-[11px] text-fg-3">
                        {comment.length}/500
                      </Text>
                    </View>

                    {/* Action button */}
                    <Pressable
                      testID={testID ? `${testID}-submit-btn` : "rating-sheet-submit-btn"}
                      onPress={handleSubmit}
                      disabled={score === 0 || isPending}
                      className={`items-center justify-center rounded-xl py-3.5 ${
                        score > 0 && !isPending
                          ? "bg-lime-500 active:bg-lime-400"
                          : "bg-bg-mute opacity-50"
                      }`}
                    >
                      {isPending ? (
                        <ActivityIndicator size="small" color="#0B0F14" />
                      ) : (
                        <Text
                          className={`font-sans-semibold text-small ${
                            score > 0 ? "text-ink-950" : "text-fg-3"
                          }`}
                        >
                          {isEditing ? "Guardar cambios" : "Enviar calificación"}
                        </Text>
                      )}
                    </Pressable>
                  </ScrollView>
                </SafeAreaView>
              </Animated.View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaProvider>
    </Modal>
  );
}
