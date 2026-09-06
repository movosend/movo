import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { act, fireEvent, render } from "@testing-library/react-native";
import type { ShipmentSummary } from "../src/api/shipments-client";
import CreateOfferScreen from "../app/(app)/transport/[id]/offer";

const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
const mockRouterPush = jest.fn();
const mockCanGoBack = jest.fn(() => true);

jest.mock("expo-router", () => ({
  router: {
    back: (...args: unknown[]) => mockRouterBack(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
    push: (...args: unknown[]) => mockRouterPush(...args),
    canGoBack: () => mockCanGoBack(),
  },
  useLocalSearchParams: () => ({ id: "shipment-1" }),
}));

const mockUseShipment = jest.fn();
jest.mock("../src/hooks/use-shipments", () => ({
  useShipment: () => mockUseShipment(),
}));

const mockMutateAsync = jest.fn();
let mockIsPending = false;
jest.mock("../src/hooks/use-offers", () => ({
  useCreateOffer: () => ({
    mutateAsync: mockMutateAsync,
    isPending: mockIsPending,
  }),
}));

jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: () => ({ data: { fullName: "Pedro Yorlano" } }),
}));

// El control real depende de gestos nativos (react-native-gesture-handler) que no
// tienen representación simulable en RNTL -- mismo criterio que el mock de
// `@react-native-menu/menu` en `sender-actions-bar.tsx`: se reemplaza por un
// `Pressable` liviano que dispara `onConfirm` directo, para poder seguir probando
// el submit del formulario sin simular el drag en sí (eso queda para QA manual).
jest.mock("../components/ui/slide-to-confirm", () => {
  const { Pressable, Text } = require("react-native");
  return {
    SlideToConfirm: ({
      label,
      onConfirm,
      disabled,
      loading,
      testID,
    }: {
      label: string;
      onConfirm: () => void;
      disabled?: boolean;
      loading?: boolean;
      testID?: string;
    }) => (
      <Pressable testID={testID} onPress={onConfirm} disabled={disabled || loading}>
        <Text>{loading ? "..." : label}</Text>
      </Pressable>
    ),
  };
});

function shipment(overrides: Partial<ShipmentSummary> = {}): ShipmentSummary {
  return {
    id: "shipment-1",
    senderId: "user-1",
    receiverId: "receiver-1",
    carrierId: null,
    packageType: "standard_package",
    weightKg: 2,
    lengthCm: 20,
    widthCm: 20,
    heightCm: 20,
    description: null,
    urgent: false,
    pickupAddress: "Av. Colón 1234, Córdoba",
    pickupLat: -31.4,
    pickupLng: -64.18,
    deliveryAddress: "Bv. San Juan 500, Córdoba",
    deliveryLat: -31.41,
    deliveryLng: -64.19,
    pickupDate: "2026-08-20",
    pickupTimeWindowStart: "09:00",
    pickupTimeWindowEnd: "12:00",
    suggestedPriceArs: 4500,
    agreedPriceArs: null,
    paymentMethod: null,
    status: ShipmentStatus.PUBLISHED,
    lastStatusChangedAt: null,
    deliveredAt: null,
    createdAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("CreateOfferScreen (MOVO-177)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsPending = false;
    mockUseShipment.mockReturnValue({ data: shipment() });
  });

  /** El formulario se partió en 2 pasos (precio / retiro) -- los tests que ejercitan
   * el paso 2 (fecha, mensaje, submit) primero tienen que avanzar tocando "Continuar". */
  async function goToPickupStep(getByTestId: Awaited<ReturnType<typeof render>>["getByTestId"]) {
    await act(async () => {
      fireEvent.press(getByTestId("create-offer-continue"));
    });
  }

  it("prellena el monto con el precio sugerido en modo bruto (default) y muestra el desglose en tiempo real", async () => {
    const { getByTestId } = await render(<CreateOfferScreen />);

    // Default "gross": el monto tipeado ES el bruto -- sin conversión, coincide 1:1
    // con `suggestedPriceArs` (que ya es el precio bruto que vio el emisor).
    expect(getByTestId("create-offer-amount-trigger")).toHaveTextContent("4.500", { exact: false });
    expect(getByTestId("create-offer-gross-preview")).toHaveTextContent("$4.500");
    // neto = bruto / 1.15 = 3913,04
    expect(getByTestId("create-offer-net-preview")).toHaveTextContent("$3.913,04");
  });

  it("el toggle bruto/neto solo cambia la vista, nunca el ancla -- ida y vuelta no pierde centavos", async () => {
    const { getByTestId } = await render(<CreateOfferScreen />);

    // Arranca en "gross" (bruto) con 4500 tipeado -- ese sigue siendo el ancla real.
    await act(async () => {
      fireEvent.press(getByTestId("create-offer-mode-net"));
    });
    // El trigger muestra la proyección redondeada a pesos enteros para poder seguir
    // editándola con el numpad...
    expect(getByTestId("create-offer-amount-trigger")).toHaveTextContent("3.913", { exact: false });
    // ...pero el desglose "Te queda" sigue siendo el neto EXACTO derivado del ancla
    // real (4500 / 1.15 = 3913,04), no el entero redondeado -- cambiar de tab no lo
    // tocó para nada.
    expect(getByTestId("create-offer-net-preview")).toHaveTextContent("$3.913,04");

    await act(async () => {
      fireEvent.press(getByTestId("create-offer-mode-gross"));
    });
    // Al volver a "gross" sin haber tocado el teclado en el medio, el ancla nunca
    // cambió -- el bruto vuelve a ser EXACTAMENTE 4500, ni un centavo de más o de
    // menos (antes del fix, esta vuelta perdía precisión en cada toggle).
    expect(getByTestId("create-offer-amount-trigger")).toHaveTextContent("4.500", { exact: false });
    expect(getByTestId("create-offer-gross-preview")).toHaveTextContent("$4.500");
  });

  it("el chip 'Sugerido' vuelve a fijar el monto al precio sugerido tras usar +10%", async () => {
    const { getByTestId } = await render(<CreateOfferScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("create-offer-quick-plus10"));
    });
    expect(getByTestId("create-offer-amount-trigger")).toHaveTextContent("4.950", { exact: false });

    await act(async () => {
      fireEvent.press(getByTestId("create-offer-quick-suggested"));
    });
    expect(getByTestId("create-offer-amount-trigger")).toHaveTextContent("4.500", { exact: false });
  });

  it("MOVO-177 (feedback de UI): el formulario en 2 pasos -- 'Continuar' avanza, el back del header retrocede un paso antes de salir", async () => {
    const { getByTestId, queryByTestId } = await render(<CreateOfferScreen />);

    // Paso 1: solo el monto, sin "Cuándo retirás" ni el botón de enviar.
    expect(getByTestId("create-offer-amount-trigger")).toBeTruthy();
    expect(queryByTestId("create-offer-date-requested")).toBeNull();
    expect(queryByTestId("create-offer-submit")).toBeNull();

    await goToPickupStep(getByTestId);

    // Paso 2: ya no se ve el monto, sí la fecha de retiro y el submit.
    expect(queryByTestId("create-offer-amount-trigger")).toBeNull();
    expect(getByTestId("create-offer-date-requested")).toBeTruthy();
    expect(getByTestId("create-offer-submit")).toBeTruthy();

    // El back del header vuelve al paso 1, no sale de la pantalla.
    await act(async () => {
      fireEvent.press(getByTestId("create-offer-back"));
    });
    expect(getByTestId("create-offer-amount-trigger")).toBeTruthy();
    expect(mockRouterBack).not.toHaveBeenCalled();
  });

  it("'Continuar' queda deshabilitado sin un monto válido", async () => {
    mockUseShipment.mockReturnValue({ data: shipment({ suggestedPriceArs: 0 }) });
    const { getByTestId, queryByTestId } = await render(<CreateOfferScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("create-offer-continue"));
    });

    // Sin monto (0), "Continuar" no avanza -- se sigue viendo el paso 1.
    expect(queryByTestId("create-offer-date-requested")).toBeNull();
  });

  it("editar el monto después de cambiar de tab adopta la proyección redondeada como nuevo ancla", async () => {
    const { getByTestId } = await render(<CreateOfferScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("create-offer-mode-net"));
    });
    // Vista neta: 3913 (proyección redondeada de 4500 bruto / 1.15).
    expect(getByTestId("create-offer-amount-trigger")).toHaveTextContent("3.913", { exact: false });

    // Tocar el teclado ahora "adopta" ese 3913 como el neto realmente tipeado --
    // borrar un dígito debe partir de 3913, no del 4500 original (otra moneda).
    await act(async () => {
      fireEvent.press(getByTestId("create-offer-amount-trigger"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("create-offer-key-del"));
    });
    expect(getByTestId("create-offer-amount-trigger")).toHaveTextContent("391", { exact: false });
  });

  it("el numpad edita el monto dígito a dígito", async () => {
    const { getByTestId } = await render(<CreateOfferScreen />);

    await act(async () => {
      fireEvent.press(getByTestId("create-offer-amount-trigger"));
    });
    await act(async () => {
      fireEvent.press(getByTestId("create-offer-key-del"));
      fireEvent.press(getByTestId("create-offer-key-del"));
      fireEvent.press(getByTestId("create-offer-key-del"));
      fireEvent.press(getByTestId("create-offer-key-del"));
      fireEvent.press(getByTestId("create-offer-key-1"));
      fireEvent.press(getByTestId("create-offer-key-0"));
      fireEvent.press(getByTestId("create-offer-key-0"));
      fireEvent.press(getByTestId("create-offer-key-0"));
    });

    expect(getByTestId("create-offer-amount-trigger")).toHaveTextContent("1.000", { exact: false });
  });

  it("permite vaciar el campo por completo para escribir un monto propio desde cero (regresión del bug de prefill)", async () => {
    const { getByTestId } = await render(<CreateOfferScreen />);

    // Bug real: el prefill del sugerido dependía de `amount` en sus deps, así que
    // cada vez que se vaciaba el campo (con el numpad, borrando dígito a dígito) el
    // efecto lo volvía a completar solo en el próximo render. Ahora usa un `useRef`
    // que solo prefillea una vez.
    await act(async () => {
      fireEvent.press(getByTestId("create-offer-amount-trigger"));
    });
    await act(async () => {
      // "4500" son 4 dígitos -- 4 borrados lo dejan completamente vacío.
      fireEvent.press(getByTestId("create-offer-key-del"));
      fireEvent.press(getByTestId("create-offer-key-del"));
      fireEvent.press(getByTestId("create-offer-key-del"));
      fireEvent.press(getByTestId("create-offer-key-del"));
    });
    expect(getByTestId("create-offer-amount-trigger")).toHaveTextContent("0", { exact: false });

    await act(async () => {
      fireEvent.press(getByTestId("create-offer-key-7"));
      fireEvent.press(getByTestId("create-offer-key-5"));
      fireEvent.press(getByTestId("create-offer-key-0"));
    });
    expect(getByTestId("create-offer-amount-trigger")).toHaveTextContent("750", { exact: false });
  });

  it("envía la oferta con la fecha pedida por el emisor por defecto y muestra la pantalla de éxito", async () => {
    mockMutateAsync.mockResolvedValue({
      id: "offer-1",
      shipmentId: "shipment-1",
      priceOffered: 5175,
      priceNetArs: 4500,
      commissionAmountArs: 675,
      offeredDate: "2026-08-20T00:00:00.000Z",
      offeredPickupTimeWindowStart: null,
      offeredPickupTimeWindowEnd: null,
      message: null,
      status: "pending",
    });

    // Capturamos el `setTimeout` real del auto-retorno de `OfferSuccessOverlay` en vez
    // de `jest.useFakeTimers()`: los fake timers globales interceptan también el
    // scheduler concurrente de React 19 que usa RNTL para `render`/`act` (mismo
    // gotcha documentado en CLAUDE.md sobre `render`/`renderHook` async), y dejaban
    // el árbol del test SIGUIENTE a medio montar.
    const setTimeoutSpy = jest.spyOn(globalThis, "setTimeout");

    const { getByTestId } = await render(<CreateOfferScreen />);
    await goToPickupStep(getByTestId);

    await act(async () => {
      fireEvent.press(getByTestId("create-offer-submit"));
    });

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        // Default "gross": el body siempre manda el NETO (contrato de MOVO-143 sin
        // cambios), aunque el transportista haya tipeado el bruto (4500 / 1.15).
        priceOfferedArs: 3913.04,
        offeredDate: "2026-08-20",
        offeredPickupTimeWindowStart: undefined,
        offeredPickupTimeWindowEnd: undefined,
      })
    );
    // El círculo lima "explota" a pantalla completa con la confirmación (feedback de
    // diseño) y vuelve solo al detalle del envío -- sin botones de por medio.
    expect(getByTestId("create-offer-success-overlay")).toBeTruthy();
    expect(getByTestId("create-offer-success-net")).toHaveTextContent("Te queda $4.500");
    expect(mockRouterReplace).not.toHaveBeenCalled();

    const autoReturnCall = (
      setTimeoutSpy.mock.calls as unknown as [() => void, number][]
    ).find(([, ms]) => ms === 2400);
    expect(autoReturnCall).toBeTruthy();
    await act(async () => {
      autoReturnCall![0]();
    });
    setTimeoutSpy.mockRestore();

    expect(mockRouterReplace).toHaveBeenCalledWith("/(app)/transport/shipment-1");
  });

  it("al proponer otro día/horario, exige elegir una franja antes de habilitar el envío y la manda en el body", async () => {
    mockMutateAsync.mockResolvedValue({
      id: "offer-1",
      shipmentId: "shipment-1",
      priceOffered: 5175,
      priceNetArs: 4500,
      commissionAmountArs: 675,
      offeredDate: "2026-08-21T00:00:00.000Z",
      offeredPickupTimeWindowStart: "15:00",
      offeredPickupTimeWindowEnd: "19:00",
      message: null,
      status: "pending",
    });

    const { getByTestId } = await render(<CreateOfferScreen />);
    await goToPickupStep(getByTestId);

    await act(async () => {
      fireEvent.press(getByTestId("create-offer-date-other"));
    });

    // Sin franja elegida todavía, el submit queda deshabilitado.
    await act(async () => {
      fireEvent.press(getByTestId("create-offer-submit"));
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(getByTestId("create-offer-pickup-day-1"));
      fireEvent.press(getByTestId("create-offer-pickup-slot-2"));
    });

    await act(async () => {
      fireEvent.press(getByTestId("create-offer-submit"));
    });

    expect(mockMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        offeredDate: "2026-08-21",
        offeredPickupTimeWindowStart: "15:00",
        offeredPickupTimeWindowEnd: "19:00",
      })
    );
  });

  it("muestra el aviso de verificación requerida ante 403 CARRIER_NOT_VERIFIED", async () => {
    mockMutateAsync.mockRejectedValue(new ApiError(403, "CARRIER_NOT_VERIFIED", "Necesitás verificar tu identidad."));

    const { getByTestId } = await render(<CreateOfferScreen />);
    await goToPickupStep(getByTestId);

    await act(async () => {
      fireEvent.press(getByTestId("create-offer-submit"));
    });

    expect(getByTestId("create-offer-kyc-error")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("create-offer-kyc-cta"));
    });
    expect(mockRouterPush).toHaveBeenCalledWith("/kyc");
  });

  it("muestra un error genérico ante otros fallos del servidor", async () => {
    mockMutateAsync.mockRejectedValue(new ApiError(409, "SHIPMENT_NOT_AVAILABLE_FOR_OFFER", "Ya no disponible."));

    const { getByTestId } = await render(<CreateOfferScreen />);
    await goToPickupStep(getByTestId);

    await act(async () => {
      fireEvent.press(getByTestId("create-offer-submit"));
    });

    expect(getByTestId("create-offer-error")).toBeTruthy();
  });
});
