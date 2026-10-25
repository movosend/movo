import { router, useIsFocused, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, AppState } from "react-native";
import { SupportConversationView } from "../../../components/support/support-conversation-view";
import { useSupportConversation } from "../../../src/hooks/use-support-conversation";
import { friendlyErrorMessage } from "../../../src/lib/error-messages";
import { pushOnce } from "../../../src/lib/navigation-guard";
import { supportHeaderSubtitle } from "../../../src/lib/support-format";

const OPEN_ERROR = "No pudimos abrir la consulta. Intentá de nuevo en unos minutos.";

/** MOVO-324: conversación de una consulta con el equipo de Movo. Mismo molde que el chat del envío. */
export default function SupportConversationScreen() {
  const { id, moderated } = useLocalSearchParams<{ id: string; moderated?: string }>();
  // "Al frente" = pantalla enfocada Y app activa: con el celu bloqueado el socket puede seguir vivo un rato.
  const screenFocused = useIsFocused();
  const [appActive, setAppActive] = useState(AppState.currentState === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => setAppActive(next === "active"));
    return () => sub.remove();
  }, []);
  const conv = useSupportConversation(id, { focused: screenFocused && appActive, initialModerationWarning: moderated === "1" });

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/support/conversations" as never);
  };

  // `4004` (la consulta ya no existe): se avisa y se vuelve a la lista.
  useEffect(() => {
    if (!conv.unavailable) return;
    Alert.alert("Esta consulta ya no está disponible", undefined, [{ text: "Entendido", onPress: goBack }]);
    // Solo al pasar a no disponible.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conv.unavailable]);

  const errorMessage = conv.isError ? friendlyErrorMessage(conv.error, OPEN_ERROR, { VALIDATION_FAILED: OPEN_ERROR }) : null;
  const shipment = conv.conversation?.shipment ?? null;

  return (
    <SupportConversationView
      conversationId={id}
      subtitle={supportHeaderSubtitle(conv.conversation)}
      shipment={shipment}
      timeline={conv.timeline}
      isLoading={conv.isLoading}
      errorMessage={errorMessage}
      onRetryLoad={() => void conv.refetch()}
      isEmpty={conv.isEmpty}
      resolved={conv.resolved}
      onSend={conv.send}
      onRetryMessage={conv.retry}
      onDiscardMessage={conv.discard}
      sendError={conv.sendError ? friendlyErrorMessage(conv.sendError, "No pudimos enviar el mensaje.") : null}
      moderationWarning={conv.moderationWarning}
      onDismissModeration={conv.dismissModerationWarning}
      loadOlder={conv.loadOlder}
      isLoadingOlder={conv.isLoadingOlder}
      onRefreshAttachments={conv.refreshAttachments}
      onBack={goBack}
      onOpenShipment={() => shipment && pushOnce(`/(app)/shipments/${shipment.id}`)}
    />
  );
}
