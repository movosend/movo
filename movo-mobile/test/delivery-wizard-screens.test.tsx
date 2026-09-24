import { act, fireEvent, render } from "@testing-library/react-native";

const mockRouterReplace = jest.fn();
const mockRouterBack = jest.fn();
const mockRouterPush = jest.fn();
const mockCanGoBack = jest.fn(() => false);
const mockUseLocalSearchParams = jest.fn(() => ({ id: "shipment-1" }));
const mockInvalidateQueries = jest.fn();

jest.mock("expo-router", () => {
  const { Text } = require("react-native");
  return {
    router: {
      replace: (...args: unknown[]) => mockRouterReplace(...args),
      back: (...args: unknown[]) => mockRouterBack(...args),
      push: (...args: unknown[]) => mockRouterPush(...args),
      canGoBack: () => mockCanGoBack(),
    },
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    Stack: () => {
      // Usa el Context REAL del layout (el mock de `useDeliveryResult` de más abajo
      // solo afecta a las pantallas hijas) para poder simular que `qr.tsx` confirmó.
      const { useDeliveryResult: useRealDeliveryResult } = jest.requireActual(
        "../app/(app)/shipments/[id]/delivery/_layout",
      );
      const { setResult } = useRealDeliveryResult();
      return (
        <Text testID="delivery-layout-stack" onPress={() => setResult({ stage: "delivery" })}>
          stack
        </Text>
      );
    },
    Redirect: ({ href }: { href: string }) => <Text testID="delivery-redirect">{href}</Text>,
  };
});

jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

const mockUseDeliveryWizard = jest.fn();
jest.mock("../src/hooks/use-delivery-wizard", () => ({
  useDeliveryWizard: (id: string | undefined) => mockUseDeliveryWizard(id),
}));

const mockUseShipment = jest.fn();
const mockUseEvidenceStatus = jest.fn();
jest.mock("../src/hooks/use-shipments", () => ({
  useShipment: (...args: unknown[]) => mockUseShipment(...args),
  useEvidenceStatus: (...args: unknown[]) => mockUseEvidenceStatus(...args),
}));

const mockUsePublicProfile = jest.fn<{ data: { fullName: string } | undefined }, [string | undefined]>(() => ({
  data: undefined,
}));
jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: (id: string | undefined) => mockUsePublicProfile(id),
}));

const mockCheck = jest.fn();
let mockProximity = {
  status: "idle" as string,
  distanceMeters: null as number | null,
  currentLocation: null as { lat: number; lng: number } | null,
  check: mockCheck,
};
jest.mock("../src/hooks/use-proximity-check", () => ({
  useProximityCheck: () => mockProximity,
  PROXIMITY_THRESHOLD_METERS: 100,
}));

jest.mock("../components/shipments/counterpart-card", () => {
  const { Text } = require("react-native");
  return { CounterpartCard: ({ testID }: { testID?: string }) => <Text testID={testID}>counterpart</Text> };
});

jest.mock("../components/shipments/package-card", () => {
  const { Text } = require("react-native");
  return { PackageCard: ({ testID }: { testID?: string }) => <Text testID={testID}>package</Text> };
});

jest.mock("../components/evidence/evidence-capture-step", () => {
  const { Pressable } = require("react-native");
  return {
    EvidenceCaptureStep: ({ onValidityChange }: { onValidityChange: (v: boolean) => void }) => (
      <Pressable testID="evidence-step-mock-mark-valid" onPress={() => onValidityChange(true)} />
    ),
  };
});

let mockHandshakeQrOptions: { onConfirmed: (s: unknown) => void; onEvidenceMissing?: () => void } | null = null;
const mockRegenerate = jest.fn();
const mockRetryDeviceKey = jest.fn();
let mockDeviceKeyStatus = "ready";
jest.mock("../src/hooks/use-handshake-qr", () => ({
  useHandshakeQr: (options: any) => {
    mockHandshakeQrOptions = options;
    return {
      status: "active",
      qrPayload: '{"shipmentId":"shipment-1"}',
      stage: "delivery",
      error: null,
      confirmedShipment: null,
      deviceKeyStatus: mockDeviceKeyStatus,
      retryDeviceKey: mockRetryDeviceKey,
      regenerate: mockRegenerate,
    };
  },
}));

jest.mock("../components/handshake/handshake-qr-card", () => {
  const { View } = require("react-native");
  return { HandshakeQrCard: ({ testID }: { testID?: string }) => <View testID={testID} /> };
});

let mockConfirmationResultProps: { onCtaPress?: () => void } | null = null;
jest.mock("../components/handshake/handshake-confirmation-result", () => {
  const { Pressable, Text, View } = require("react-native");
  return {
    HandshakeConfirmationResult: (props: any) => {
      mockConfirmationResultProps = props;
      return (
        <View>
          <Pressable testID={props.testID} onPress={props.onCtaPress}>
            <Text>confirmation</Text>
          </Pressable>
          {props.onSecondaryCtaPress ? (
            <Pressable testID={`${props.testID}-secondary-cta`} onPress={props.onSecondaryCtaPress}>
              <Text>{props.secondaryCtaLabel}</Text>
            </Pressable>
          ) : null}
        </View>
      );
    },
  };
});

let mockRatingSheetProps: { target: unknown; visible: boolean } | null = null;
jest.mock("../components/shipments/rating-sheet", () => {
  const { View } = require("react-native");
  return {
    RatingSheet: (props: any) => {
      mockRatingSheetProps = props;
      return <View testID={props.testID} />;
    },
  };
});

const mockUseShipmentRatings = jest.fn<
  { data: { rateeId: string; score: number; comment?: string }[] | undefined },
  [string | undefined, { enabled?: boolean } | undefined]
>(() => ({ data: undefined }));
jest.mock("../src/hooks/use-ratings", () => ({
  useShipmentRatings: (id: string | undefined, options?: { enabled?: boolean }) =>
    mockUseShipmentRatings(id, options),
}));

const mockUseDeliveryResult = jest.fn();
jest.mock("../app/(app)/shipments/[id]/delivery/_layout", () => {
  // `__esModule: true` explícito -- mismo motivo documentado en
  // `pickup-wizard-screens.test.tsx`: `actual` (transpilado por Babel) lo tiene como
  // no-enumerable, sin este flag el default export queda envuelto de más.
  const actual = jest.requireActual("../app/(app)/shipments/[id]/delivery/_layout");
  return { __esModule: true, ...actual, useDeliveryResult: () => mockUseDeliveryResult() };
});

import DeliveryWizardLayout from "../app/(app)/shipments/[id]/delivery/_layout";
import DeliveryGeoScreen from "../app/(app)/shipments/[id]/delivery/index";
import DeliveryResumenScreen from "../app/(app)/shipments/[id]/delivery/resumen";
import DeliveryScanNoticeScreen from "../app/(app)/shipments/[id]/delivery/aviso";
import DeliveryEvidenceScreen from "../app/(app)/shipments/[id]/delivery/evidence";
import DeliveryQrScreen from "../app/(app)/shipments/[id]/delivery/qr";
import DeliverySuccessScreen from "../app/(app)/shipments/[id]/delivery/success";

function shipment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "shipment-1",
    receiverId: "receiver-1",
    deliveryAddress: "Bv. Illia 500, Córdoba",
    deliveryLat: -31.42,
    deliveryLng: -64.19,
    packageType: "small_box",
    weightKg: 2,
    status: "in_transit",
    ...overrides,
  };
}

const confirmResult = {
  shipmentId: "shipment-1",
  stage: "delivery" as const,
  previousStatus: "in_transit" as const,
  status: "delivered" as const,
  distanceM: 0,
  confirmedAt: "2026-09-22T10:00:00.000Z",
};

describe("_layout (gate del wizard de entrega, AC1)", () => {
  afterEach(() => jest.clearAllMocks());

  it("loading: no renderiza el Stack ni ningún mensaje", async () => {
    mockUseDeliveryWizard.mockReturnValue({ gate: "loading" });

    const { getByTestId, queryByTestId } = await render(<DeliveryWizardLayout />);

    expect(getByTestId("delivery-wizard-loading")).toBeTruthy();
    expect(queryByTestId("delivery-layout-stack")).toBeNull();
  });

  it("already_done: no vuelve a mostrar el flujo de generación de QR", async () => {
    mockUseDeliveryWizard.mockReturnValue({ gate: "already_done" });

    const { getByTestId } = await render(<DeliveryWizardLayout />);

    expect(getByTestId("delivery-wizard-already-done")).toBeTruthy();
  });

  it("ya confirmado en esta sesión: el gate en vivo (already_done) no pisa la pantalla de éxito", async () => {
    mockUseDeliveryWizard.mockReturnValue({ gate: "ready" });

    const { getByTestId, queryByTestId, rerender } = await render(<DeliveryWizardLayout />);
    await act(async () => fireEvent.press(getByTestId("delivery-layout-stack")));

    // El backend ya pasó el envío a `delivered` y el detalle se refetchea.
    mockUseDeliveryWizard.mockReturnValue({ gate: "already_done" });
    await rerender(<DeliveryWizardLayout />);

    expect(getByTestId("delivery-layout-stack")).toBeTruthy();
    expect(queryByTestId("delivery-wizard-already-done")).toBeNull();
  });

  it.each(["not_found", "not_carrier", "invalid_state"])("%s: mensaje bloqueado con vuelta atrás", async (gate) => {
    mockUseDeliveryWizard.mockReturnValue({ gate });

    const { getByTestId } = await render(<DeliveryWizardLayout />);

    expect(getByTestId("delivery-wizard-blocked")).toBeTruthy();
  });

  it("ready: renderiza el Stack de los pasos", async () => {
    mockUseDeliveryWizard.mockReturnValue({ gate: "ready" });

    const { getByTestId } = await render(<DeliveryWizardLayout />);

    expect(getByTestId("delivery-layout-stack")).toBeTruthy();
  });
});

describe("delivery/index (paso 1: ubicación, extensión de alcance pedida por el usuario)", () => {
  beforeEach(() => {
    mockUseShipment.mockReturnValue({ data: shipment(), isLoading: false, isError: false });
    mockProximity = {
      status: "within_range",
      distanceMeters: 20,
      currentLocation: { lat: -31.4201, lng: -64.1902 },
      check: mockCheck,
    };
  });
  afterEach(() => jest.clearAllMocks());

  it("dentro de rango, Continuar navega al resumen", async () => {
    const { getByTestId } = await render(<DeliveryGeoScreen />);

    await act(async () => fireEvent.press(getByTestId("delivery-geo-continue")));
    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shipment-1/delivery/resumen");
  });

  it("fuera de rango, 'Reintentar ubicación' ocupa el lugar de 'Continuar'", async () => {
    mockProximity = { status: "out_of_range", distanceMeters: 300, currentLocation: null, check: mockCheck };
    const { getByTestId, queryByTestId } = await render(<DeliveryGeoScreen />);

    expect(queryByTestId("delivery-geo-continue")).toBeNull();
    await act(async () => fireEvent.press(getByTestId("delivery-geo-retry")));
    expect(mockCheck).toHaveBeenCalled();
  });

  it("muestra un mapa real con el pin de entrega y el pin de la ubicación actual", async () => {
    const { getByTestId } = await render(<DeliveryGeoScreen />);

    expect(getByTestId("delivery-geo-map")).toBeTruthy();
    expect(getByTestId("delivery-geo-map-target-marker")).toBeTruthy();
    expect(getByTestId("delivery-geo-map-you-marker")).toBeTruthy();
  });
});

describe("delivery/resumen (paso 2)", () => {
  beforeEach(() => {
    mockUseShipment.mockReturnValue({ data: shipment(), isLoading: false, isError: false });
  });
  afterEach(() => jest.clearAllMocks());

  it("muestra el punto de entrega, el receptor y el paquete", async () => {
    const { getByTestId } = await render(<DeliveryResumenScreen />);

    expect(getByTestId("delivery-resumen-receiver")).toBeTruthy();
    expect(getByTestId("delivery-resumen-package")).toBeTruthy();
  });

  it("'Empezar la entrega' navega al paso de aviso al receptor", async () => {
    const { getByTestId } = await render(<DeliveryResumenScreen />);

    await act(async () => fireEvent.press(getByTestId("delivery-resumen-continue")));
    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shipment-1/delivery/aviso");
  });
});

describe("delivery/aviso (paso 3: avisarle al receptor que abra la app)", () => {
  beforeEach(() => {
    mockUseShipment.mockReturnValue({ data: shipment(), isLoading: false, isError: false });
  });
  afterEach(() => {
    jest.clearAllMocks();
    mockUsePublicProfile.mockImplementation(() => ({ data: undefined }));
  });

  it("personaliza el título con el nombre del receptor cuando ya cargó", async () => {
    mockUsePublicProfile.mockImplementation(() => ({ data: { fullName: "Julia Pérez" } }));
    const { getByTestId } = await render(<DeliveryScanNoticeScreen />);

    expect(mockUsePublicProfile).toHaveBeenCalledWith("receiver-1");
    expect(getByTestId("delivery-aviso-title")).toHaveTextContent("Avisale a Julia que abra Movo");
  });

  it("sin perfil cargado, cae a un título genérico sin bloquear la pantalla", async () => {
    const { getByTestId } = await render(<DeliveryScanNoticeScreen />);

    expect(getByTestId("delivery-aviso-title")).toHaveTextContent("Avisale al receptor que abra Movo");
  });

  it("'Entendido' navega a evidencia", async () => {
    const { getByTestId } = await render(<DeliveryScanNoticeScreen />);

    await act(async () => fireEvent.press(getByTestId("delivery-aviso-continue")));
    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shipment-1/delivery/evidence");
  });
});

describe("delivery/evidence (paso 4)", () => {
  afterEach(() => jest.clearAllMocks());

  it("Continuar deshabilitado hasta que el step reporte validez, después navega al QR", async () => {
    const { getByTestId } = await render(<DeliveryEvidenceScreen />);

    await act(async () => fireEvent.press(getByTestId("delivery-evidence-continue")));
    expect(mockRouterPush).not.toHaveBeenCalled();

    await act(async () => fireEvent.press(getByTestId("evidence-step-mock-mark-valid")));
    await act(async () => fireEvent.press(getByTestId("delivery-evidence-continue")));

    expect(mockRouterPush).toHaveBeenCalledWith("/shipments/shipment-1/delivery/qr");
  });
});

describe("delivery/qr (paso 5, AC3/AC5/AC6/AC7 -- el transportista genera, roles invertidos vs. pickup)", () => {
  beforeEach(() => {
    mockUseDeliveryResult.mockReturnValue({ result: null, setResult: jest.fn() });
    mockUseShipment.mockReturnValue({ data: shipment(), isLoading: false, isError: false });
    mockUsePublicProfile.mockReturnValue({ data: undefined });
  });
  afterEach(() => jest.clearAllMocks());

  it("sin evidencia satisfecha, redirige al paso de evidencia en vez de generar el QR (AC3)", async () => {
    mockUseEvidenceStatus.mockReturnValue({ data: { satisfied: false }, isLoading: false });

    const { getByTestId, queryByTestId } = await render(<DeliveryQrScreen />);

    expect(getByTestId("delivery-redirect")).toHaveTextContent("/shipments/shipment-1/delivery/evidence");
    expect(queryByTestId("delivery-qr-card")).toBeNull();
  });

  it("con evidencia satisfecha, monta HandshakeQrCard con initialStage delivery fijo", async () => {
    mockUseEvidenceStatus.mockReturnValue({ data: { satisfied: true }, isLoading: false });

    const { getByTestId } = await render(<DeliveryQrScreen />);

    expect(getByTestId("delivery-qr-card")).toBeTruthy();
    expect(mockHandshakeQrOptions).not.toBeNull();
  });

  it("AC6: al detectarse la confirmación del receptor (onConfirmed), guarda el resultado y navega a success", async () => {
    mockUseEvidenceStatus.mockReturnValue({ data: { satisfied: true }, isLoading: false });
    const mockSetResult = jest.fn();
    mockUseDeliveryResult.mockReturnValue({ result: null, setResult: mockSetResult });

    await render(<DeliveryQrScreen />);
    mockHandshakeQrOptions?.onConfirmed({ id: "shipment-1", status: "delivered" });

    expect(mockSetResult).toHaveBeenCalledWith(
      expect.objectContaining({ shipmentId: "shipment-1", stage: "delivery", status: "delivered" }),
    );
    expect(mockRouterReplace).toHaveBeenCalledWith("/shipments/shipment-1/delivery/success");
  });

  it("si evidence-status falla sin datos, muestra el error con reintento en vez de redirigir a evidencia", async () => {
    const mockRefetch = jest.fn();
    mockUseEvidenceStatus.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: mockRefetch,
    });

    const { getByTestId, queryByTestId } = await render(<DeliveryQrScreen />);

    expect(queryByTestId("delivery-redirect")).toBeNull();
    await act(async () => {
      fireEvent.press(getByTestId("evidence-status-error-retry"));
    });
    expect(mockRefetch).toHaveBeenCalled();
  });

  it("con un refetch fallido pero datos satisfechos en caché, sigue mostrando el QR", async () => {
    mockUseEvidenceStatus.mockReturnValue({ data: { satisfied: true }, isLoading: false, isError: true });

    const { getByTestId } = await render(<DeliveryQrScreen />);

    expect(getByTestId("delivery-qr-card")).toBeTruthy();
  });

  it("con la clave del dispositivo en error, muestra el aviso con reintento", async () => {
    mockUseEvidenceStatus.mockReturnValue({ data: { satisfied: true }, isLoading: false });
    mockDeviceKeyStatus = "error";

    try {
      const { getByTestId } = await render(<DeliveryQrScreen />);
      expect(getByTestId("delivery-qr-device-key-warning")).toBeTruthy();
      await act(async () => {
        fireEvent.press(getByTestId("handshake-device-key-retry"));
      });
      expect(mockRetryDeviceKey).toHaveBeenCalled();
    } finally {
      mockDeviceKeyStatus = "ready";
    }
  });

  it("con la clave lista, no muestra el aviso", async () => {
    mockUseEvidenceStatus.mockReturnValue({ data: { satisfied: true }, isLoading: false });

    const { queryByTestId } = await render(<DeliveryQrScreen />);

    expect(queryByTestId("delivery-qr-device-key-warning")).toBeNull();
  });

  it("AC7: onEvidenceMissing invalida evidence-status y vuelve al paso de evidencia", async () => {
    mockUseEvidenceStatus.mockReturnValue({ data: { satisfied: true }, isLoading: false });

    await render(<DeliveryQrScreen />);
    mockHandshakeQrOptions?.onEvidenceMissing?.();

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["shipments", "detail", "shipment-1", "evidence-status"],
    });
    expect(mockRouterReplace).toHaveBeenCalledWith("/shipments/shipment-1/delivery/evidence");
  });
});

describe("delivery/success (AC8/AC9)", () => {
  afterEach(() => jest.clearAllMocks());

  it("sin resultado en contexto (reingreso directo), degrada a un mensaje simple", async () => {
    mockUseDeliveryResult.mockReturnValue({ result: null, setResult: jest.fn() });

    const { getByTestId } = await render(<DeliverySuccessScreen />);

    expect(getByTestId("delivery-success-no-result")).toBeTruthy();
    await act(async () => fireEvent.press(getByTestId("delivery-success-no-result-cta")));
    expect(mockRouterReplace).toHaveBeenCalledWith("/shipments/shipment-1");
  });

  it("con resultado, el CTA vuelve al detalle del envío (a diferencia de pickup, sin ruta que trackear)", async () => {
    mockUseDeliveryResult.mockReturnValue({ result: confirmResult, setResult: jest.fn() });
    mockUseShipment.mockReturnValue({ data: shipment(), isLoading: false, isError: false });

    const { getByTestId } = await render(<DeliverySuccessScreen />);

    expect(getByTestId("delivery-success-result")).toBeTruthy();
    await act(async () => fireEvent.press(getByTestId("delivery-success-result")));

    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ["shipments", "detail", "shipment-1"] });
    expect(mockRouterReplace).toHaveBeenCalledWith("/shipments/shipment-1");
  });

  it("AC9: con el receptor resuelto, muestra el CTA de calificar y abre el RatingSheet con el target correcto", async () => {
    mockUseDeliveryResult.mockReturnValue({ result: confirmResult, setResult: jest.fn() });
    mockUseShipment.mockReturnValue({ data: shipment(), isLoading: false, isError: false });
    mockUsePublicProfile.mockReturnValue({ data: { fullName: "Julia Mancini" } });
    mockUseShipmentRatings.mockReturnValue({ data: [] });

    const { getByTestId } = await render(<DeliverySuccessScreen />);

    expect(getByTestId("delivery-success-result-secondary-cta")).toHaveTextContent("Calificar al receptor");
    await act(async () => fireEvent.press(getByTestId("delivery-success-result-secondary-cta")));

    expect(mockRatingSheetProps?.visible).toBe(true);
    expect(mockRatingSheetProps?.target).toEqual(
      expect.objectContaining({ userId: "receiver-1", fullName: "Julia Mancini", roleLabel: "Receptor" }),
    );
  });

  it("AC9: si ya calificó al receptor, el CTA lo refleja en el label", async () => {
    mockUseDeliveryResult.mockReturnValue({ result: confirmResult, setResult: jest.fn() });
    mockUseShipment.mockReturnValue({ data: shipment(), isLoading: false, isError: false });
    mockUsePublicProfile.mockReturnValue({ data: { fullName: "Julia Mancini" } });
    mockUseShipmentRatings.mockReturnValue({
      data: [{ rateeId: "receiver-1", score: 5, comment: "Todo perfecto" }],
    });

    const { getByTestId } = await render(<DeliverySuccessScreen />);

    expect(getByTestId("delivery-success-result-secondary-cta")).toHaveTextContent("Ya calificaste al receptor");
  });
});
