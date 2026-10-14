import { router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { AddCardWizard } from "../../../../components/payments/add-card-wizard";
import { useSavedCards } from "../../../../src/hooks/use-saved-cards";
import { savedCardToast } from "../../../../src/lib/saved-cards";

/**
 * Alta de tarjeta desde "Pagos y cobros" (MOVO-101). La pantalla solo monta el wizard
 * reutilizable y vuelve a la lista con el aviso de guardado; MOVO-269 monta el mismo wizard
 * desde el pago.
 */
export default function AddCardScreen() {
  const cards = useSavedCards().data;

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/profile/payments");
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
      <AddCardWizard
        cards={cards}
        onCancel={goBack}
        onSaved={(card, { defaultFailed }) => {
          // `dismissTo` (MOVO-271): vuelve a la instancia de "Pagos y cobros" que abrió el
          // alta en vez de apilar otra.
          router.dismissTo({ pathname: "/profile/payments", params: { toast: savedCardToast(card, defaultFailed) } });
        }}
      />
    </SafeAreaView>
  );
}
