import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { Modal } from "react-native";
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from "react-native-safe-area-context";
import { AddCardWizard } from "./add-card-wizard";

// `initialWindowMetrics` es `null` en Jest (sin native module); en device siempre viene poblado.
const FALLBACK_METRICS = {
  frame: { x: 0, y: 0, width: 0, height: 0 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

interface PayAddCardModalProps {
  visible: boolean;
  /** Tarjetas actuales: si ninguna está vigente, la nueva queda predeterminada sí o sí. */
  cards: SavedCard[] | undefined;
  onClose: () => void;
  /** La tarjeta ya quedó guardada (y en la cache de tarjetas); quien abre la elige. */
  onSaved: (card: SavedCard) => void;
}

/**
 * "Agregar tarjeta nueva" desde la pantalla de pago (MOVO-269 AC5): monta el `AddCardWizard`
 * de MOVO-101 tal cual, a pantalla completa, sin una segunda implementación del alta. Es un
 * `Modal` (mismo patrón que `AddressSearchSheet`) y no una ruta para volver a la pantalla de
 * pago sin perder el estado y con la tarjeta nueva a mano.
 *
 * El token de alta se genera con la `public_key` de Movo y no sirve para pagar al transportista:
 * quien abre el modal vuelve a pedir el código de seguridad.
 */
export function PayAddCardModal({ visible, cards, onClose, onSaved }: PayAddCardModalProps) {
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} testID="pay-add-card-modal">
      <SafeAreaProvider initialMetrics={initialWindowMetrics ?? FALLBACK_METRICS}>
        <SafeAreaView className="flex-1 bg-bg" edges={["top"]}>
          {/* Montado solo abierto: el wizard guarda número y CVV en su estado local y se pierden al cerrar. */}
          {visible ? <AddCardWizard cards={cards} onCancel={onClose} onSaved={(card) => onSaved(card)} /> : null}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
