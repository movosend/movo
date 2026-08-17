import { router } from "expo-router";
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { PrimaryButton } from "../../components/auth/primary-button";
import { WizardHeader } from "../../components/auth/wizard-header";
import {
  AddressStep,
  isAddressStepValid,
} from "../../components/send/steps/address-step";
import {
  PackageStep,
  isPackageStepValid,
} from "../../components/send/steps/package-step";
import {
  PhotosStep,
  isPhotosStepValid,
} from "../../components/send/steps/photos-step";
import {
  ReceiverStep,
  isReceiverStepValid,
} from "../../components/send/steps/receiver-step";
import { SummaryStep } from "../../components/send/steps/summary-step";
import { useKeyboardScroll } from "../../src/hooks/use-keyboard-scroll";
import { useShipmentWizardStore } from "../../src/store/shipment-wizard-store";

const TOTAL_STEPS = 5;
const STEP_LABELS = ["Paso 1", "Paso 2", "Paso 3", "Paso 4", "Paso 5"];

/**
 * Wizard de creación de envío (MOVO-83): paquete → receptor → direcciones+franja
 * horaria → fotos → resumen/confirmación. Shell delgado — la fuente de verdad de
 * cada campo vive en `useShipmentWizardStore` (Zustand, sobrevive a navegar afuera y
 * volver, AC11), este archivo solo orquesta el paso actual, la validación por paso y
 * el botón primario fijo abajo. El paso de resumen (`SummaryStep`) es la excepción:
 * arma su propio submit y su propio botón, porque orquesta la creación del envío +
 * la subida de fotos post-creación (ver el comentario en `photos-step.tsx` sobre por
 * qué el upload real pasa a esa etapa en vez del paso de fotos).
 *
 * Sibling de `license-kyc.tsx` dentro de `app/(app)/` (no de `(tabs)/`) — mismo
 * criterio que la versión placeholder de esta pantalla (MOVO-83 parcial).
 */
export default function SendShipmentScreen() {
  const store = useShipmentWizardStore();
  const { step, setStep, resetWizard } = store;
  const { scrollRef, onScroll, onFocusInput } = useKeyboardScroll();

  function goToStep(next: number) {
    setStep(Math.max(0, Math.min(TOTAL_STEPS - 1, next)));
  }

  function handleBack() {
    if (step === 0) {
      Alert.alert(
        "¿Descartar este envío?",
        "Vas a perder los datos que cargaste hasta ahora.",
        [
          { text: "Seguir cargando", style: "cancel" },
          {
            text: "Descartar",
            style: "destructive",
            onPress: () => {
              resetWizard();
              router.back();
            },
          },
        ],
      );
      return;
    }
    goToStep(step - 1);
  }

  const isCurrentStepValid = (() => {
    switch (step) {
      case 0:
        return isPackageStepValid(store);
      case 1:
        return isReceiverStepValid(store);
      case 2:
        return isAddressStepValid(store);
      case 3:
        return isPhotosStepValid(store);
      default:
        return true;
    }
  })();

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <WizardHeader
        testID="send-wizard-back"
        progress={(step + 1) / TOTAL_STEPS}
        stepLabel={STEP_LABELS[step]}
        onBack={handleBack}
      />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 16 : 0}
      >
        <ScrollView
          ref={scrollRef}
          className="flex-1 px-5"
          contentContainerClassName="pb-8"
          keyboardShouldPersistTaps="handled"
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          <Pressable onPress={Keyboard.dismiss}>
            {step === 0 ? <PackageStep onFocusInput={onFocusInput} /> : null}
            {step === 1 ? <ReceiverStep onFocusInput={onFocusInput} /> : null}
            {step === 2 ? <AddressStep /> : null}
            {step === 3 ? <PhotosStep /> : null}
            {step === 4 ? <SummaryStep onGoToStep={goToStep} /> : null}
          </Pressable>
        </ScrollView>

        {step < 4 ? (
          <PrimaryButton
            testID="send-wizard-next"
            label="Siguiente"
            disabled={!isCurrentStepValid}
            onPress={() => goToStep(step + 1)}
          />
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
