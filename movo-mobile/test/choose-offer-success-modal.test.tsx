import { act, render } from "@testing-library/react-native";
import { useState } from "react";
import { AUTO_DISMISS_MS, ChooseOfferSuccessModal } from "../components/shipments/choose-offer-success-modal";

/**
 * MOVO-244 review (PR #184): `onDismiss` no está memoizado en todos los callers
 * (`offers.tsx` le pasa una función inline) — un re-render del padre mientras el
 * modal está visible no debería reiniciar el timer de auto-dismiss.
 */
function Wrapper({ onDismiss }: { onDismiss: () => void }) {
  const [, forceRerender] = useState(0);
  return (
    <ChooseOfferSuccessModal
      visible
      carrierName="Juan Cruz"
      // Función inline a propósito, distinta identidad en cada render — mismo
      // patrón que `offers.tsx#handleSuccessDismiss`.
      onDismiss={() => {
        onDismiss();
        forceRerender((n) => n + 1);
      }}
      testID="success-modal"
    />
  );
}

describe("ChooseOfferSuccessModal (MOVO-150 / MOVO-244)", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("se auto-cierra AUTO_DISMISS_MS después de abrirse, no antes", async () => {
    const onDismiss = jest.fn();
    await render(<Wrapper onDismiss={onDismiss} />);

    await act(async () => {
      jest.advanceTimersByTime(AUTO_DISMISS_MS - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1);
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("un re-render del padre a mitad de camino (nueva identidad de onDismiss) no reinicia el auto-dismiss", async () => {
    const onDismiss = jest.fn();
    const { rerender } = await render(<Wrapper onDismiss={onDismiss} />);

    await act(async () => {
      jest.advanceTimersByTime(AUTO_DISMISS_MS / 2); // a mitad de camino del timer
    });

    // Simula el refetch/invalidation que `offers.tsx#handleConfirmAccept` dispara
    // justo después de mostrar el modal: el padre re-renderiza con un `onDismiss`
    // inline de identidad nueva, mismo `visible`.
    await act(async () => {
      rerender(<Wrapper onDismiss={onDismiss} />);
    });

    await act(async () => {
      jest.advanceTimersByTime(AUTO_DISMISS_MS / 2); // completa el plazo original
    });

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
