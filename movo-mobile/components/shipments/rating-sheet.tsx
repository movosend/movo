import * as Haptics from "expo-haptics";
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
import {
  CARRIER_RATING_CATEGORIES,
  SENDER_RATING_CATEGORIES,
  RECEIVER_RATING_CATEGORIES,
  type RatingCategoryDefinition,
  type RatingCategoryScoreField,
} from "@movo/shared/dist/config/rating-categories";
import { AvatarImage } from "../ui/avatar-image";
import { ErrorBanner } from "../ui/error-banner";
import { RatingSuccessMoment } from "./rating-success-moment";
import { StarRatingInput } from "../ui/star-rating-input";
import type { Rating, RatingCategoryScoresInput, RatingRole } from "../../src/api/ratings-client";
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
  /** Foto de la persona calificada; sin ella el avatar cae a las iniciales. */
  photoUrl?: string | null;
  roleLabel: string;
  /** MOVO-173: rol del CALIFICADO en este envío -- decide qué categorías se piden. */
  rateeRole: RatingRole;
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

/** Cuánto se ve la confirmación (tilde + vibración) antes de cerrar el sheet. */
const SUCCESS_HOLD_MS = 1100;

const SCORE_LABELS: Record<number, string> = {
  1: "Mala experiencia",
  2: "Regular",
  3: "Buena",
  4: "Muy buena",
  5: "Excelente",
};

/** MOVO-173: emisor y receptor comparten set (puntualidad/comunicación). */
function categoriesForRole(role: RatingRole): readonly RatingCategoryDefinition[] {
  if (role === "carrier") return CARRIER_RATING_CATEGORIES;
  if (role === "sender") return SENDER_RATING_CATEGORIES;
  return RECEIVER_RATING_CATEGORIES;
}

function initialCategoryScores(rating?: Rating): RatingCategoryScoresInput {
  const scores: RatingCategoryScoresInput = {};
  for (const field of [
    "punctualityScore",
    "careScore",
    "communicationScore",
  ] as const) {
    const value = rating?.[field];
    if (typeof value === "number") {
      scores[field] = value;
    }
  }
  return scores;
}

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
  const [categoryScores, setCategoryScores] = useState<RatingCategoryScoresInput>(() =>
    initialCategoryScores(effectiveTarget?.existingRating),
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Tras enviar bien el formulario se reemplaza por la confirmación animada hasta que cierra.
  const [submitted, setSubmitted] = useState(false);
  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `onSuccess`/`onClose` se invocan recién al terminar la confirmación: por ref, para no
  // llamar a una versión vieja si el padre se re-renderiza mientras tanto.
  const onSuccessRef = useRef(onSuccess);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onCloseRef.current = onClose;
  });
  useEffect(
    () => () => {
      if (successTimer.current) clearTimeout(successTimer.current);
    },
    [],
  );

  const categories = effectiveTarget ? categoriesForRole(effectiveTarget.rateeRole) : [];

  // Categorías que el usuario ya eligió a mano (o que vienen de la calificación que edita):
  // la estrella general las autocompleta solo si NO están acá, así cambiar el puntaje general
  // después nunca pisa una elección puntual.
  const touchedCategories = useRef<Set<RatingCategoryScoreField>>(
    new Set(Object.keys(initialCategoryScores(effectiveTarget?.existingRating)) as RatingCategoryScoreField[]),
  );

  // Reset recién cuando el sheet terminó de cerrarse: si fuera al abrir, un frame mostraría
  // la confirmación vieja; si fuera al empezar a cerrar, se vería el formulario deslizándose.
  useEffect(() => {
    if (!isMounted) {
      setSubmitted(false);
    }
  }, [isMounted]);

  // Sincronizar estado cuando cambia el target o se abre el sheet
  useEffect(() => {
    if (visible && target) {
      setScore(target.existingRating?.score ?? 0);
      setComment(target.existingRating?.comment ?? "");
      const initial = initialCategoryScores(target.existingRating);
      setCategoryScores(initial);
      touchedCategories.current = new Set(Object.keys(initial) as RatingCategoryScoreField[]);
      setErrorMessage(null);
    }
  }, [visible, target]);

  const createMutation = useCreateRating(shipmentId);
  const updateMutation = useUpdateRating(shipmentId);
  const isPending = createMutation.isPending || updateMutation.isPending;

  // Calificar en general autocompleta con el mismo valor las categorías todavía sin tocar.
  const handleScoreChange = (value: number) => {
    setScore(value);
    setCategoryScores((prev) => {
      const next = { ...prev };
      for (const { scoreField } of categories) {
        if (!touchedCategories.current.has(scoreField)) {
          next[scoreField] = value;
        }
      }
      return next;
    });
  };

  const handleCategoryChange = (field: RatingCategoryScoreField, value: number) => {
    touchedCategories.current.add(field);
    setCategoryScores((prev) => ({ ...prev, [field]: value }));
  };

  const handleClose = () => {
    Keyboard.dismiss();
    if (!isPending && !submitted) {
      onClose();
    }
  };

  const finishSubmit = (rating: Rating) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setSubmitted(true);
    successTimer.current = setTimeout(() => {
      onSuccessRef.current?.(rating);
      onCloseRef.current();
    }, SUCCESS_HOLD_MS);
  };

  const handleSubmit = async () => {
    if (score < 1 || score > 5 || !effectiveTarget) {
      return;
    }
    setErrorMessage(null);
    Keyboard.dismiss();

    const trimmedComment = comment.trim() || undefined;

    // MOVO-173: opcionales, mismo criterio que `comment` -- solo viajan las que el usuario
    // tocó. En edición esto es el estado completo (el backend reemplaza, no mergea).
    const categoryInput: RatingCategoryScoresInput = {};
    for (const { scoreField } of categories) {
      const value = categoryScores[scoreField];
      if (value !== undefined && value > 0) {
        categoryInput[scoreField] = value;
      }
    }

    try {
      if (isEditing) {
        const updated = await updateMutation.mutateAsync({
          rateeId: effectiveTarget.userId,
          input: { score, comment: trimmedComment, ...categoryInput },
        });
        finishSubmit(updated);
      } else {
        const created = await createMutation.mutateAsync({
          rateeId: effectiveTarget.userId,
          score,
          comment: trimmedComment ?? undefined,
          ...categoryInput,
        });
        finishSubmit(created);
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
                  {submitted ? (
                    <RatingSuccessMoment
                      testID={testID ? `${testID}-success` : "rating-sheet-success"}
                      title={isEditing ? "¡Calificación actualizada!" : "¡Gracias por calificar!"}
                      subtitle={`Tu opinión sobre ${effectiveTarget.fullName} ayuda a la comunidad de Movo.`}
                    />
                  ) : (
                    <ScrollView
                      keyboardShouldPersistTaps="handled"
                      contentContainerClassName="gap-5 pb-4"
                      showsVerticalScrollIndicator={false}
                      bounces={false}
                    >
                      {/* Header */}
                      <View className="flex-row items-center justify-between">
                        <View className="mr-3">
                          <AvatarImage
                            testID={testID ? `${testID}-avatar` : "rating-sheet-avatar"}
                            fullName={effectiveTarget.fullName}
                            photoUrl={effectiveTarget.photoUrl ?? null}
                            size={48}
                          />
                        </View>
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
                          onChange={handleScoreChange}
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

                      {/* Sub-categorías según el rol del calificado (MOVO-173) */}
                      {categories.length > 0 ? (
                        <View className="gap-3">
                          <Text className="font-sans-medium text-caption text-fg-3">
                            Detalle de la experiencia (opcional)
                          </Text>
                          {categories.map(({ key, label, scoreField }) => (
                            <View key={key} className="flex-row items-center justify-between">
                              <Text className="flex-1 pr-3 font-sans text-small text-fg">{label}</Text>
                              <StarRatingInput
                                score={categoryScores[scoreField] ?? 0}
                                onChange={(value) => handleCategoryChange(scoreField, value)}
                                size={20}
                                gap={6}
                                testID={`${testID ?? "rating-sheet"}-category-${key}`}
                              />
                            </View>
                          ))}
                        </View>
                      ) : null}

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
                  )}
                </SafeAreaView>
              </Animated.View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaProvider>
    </Modal>
  );
}
