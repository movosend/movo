import { renderHook, waitFor } from "@testing-library/react-native";
import { useDeliveryWizard } from "../src/hooks/use-delivery-wizard";
import { useShipment, useEvidenceStatus } from "../src/hooks/use-shipments";

jest.mock("../src/hooks/use-shipments", () => ({
  useShipment: jest.fn(),
  useEvidenceStatus: jest.fn(),
}));

let mockUserId: string | undefined = "carrier-1";
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: any) => selector({ user: mockUserId ? { userId: mockUserId } : undefined }),
}));

function shipment(overrides: Partial<{ status: string; carrierId: string | null }> = {}) {
  return {
    id: "shipment-1",
    carrierId: "carrier-1",
    status: "in_transit",
    ...overrides,
  };
}

describe("useDeliveryWizard (MOVO-199, calcado de usePickupWizard MOVO-198)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = "carrier-1";
    (useEvidenceStatus as jest.Mock).mockReturnValue({ data: undefined, isLoading: true });
  });

  it("mientras el envío está cargando, gate es loading", async () => {
    (useShipment as jest.Mock).mockReturnValue({ data: undefined, isLoading: true, isError: false });

    const { result } = await renderHook(() => useDeliveryWizard("shipment-1"));

    expect(result.current.gate).toBe("loading");
  });

  it("envío inexistente o error de red, gate es not_found", async () => {
    (useShipment as jest.Mock).mockReturnValue({ data: undefined, isLoading: false, isError: true });

    const { result } = await renderHook(() => useDeliveryWizard("shipment-1"));

    expect(result.current.gate).toBe("not_found");
  });

  it("el caller no es el carrierId asignado, gate es not_carrier", async () => {
    mockUserId = "otro-usuario";
    (useShipment as jest.Mock).mockReturnValue({ data: shipment(), isLoading: false, isError: false });

    const { result } = await renderHook(() => useDeliveryWizard("shipment-1"));

    expect(result.current.gate).toBe("not_carrier");
  });

  it("in_transit: gate es ready, el único caso que abre el wizard de verdad", async () => {
    (useShipment as jest.Mock).mockReturnValue({ data: shipment(), isLoading: false, isError: false });

    const { result } = await renderHook(() => useDeliveryWizard("shipment-1"));

    expect(result.current.gate).toBe("ready");
  });

  it.each(["delivered", "completed"])(
    "%s: el handshake ya se confirmó, gate es already_done",
    async (status) => {
      (useShipment as jest.Mock).mockReturnValue({
        data: shipment({ status }),
        isLoading: false,
        isError: false,
      });

      const { result } = await renderHook(() => useDeliveryWizard("shipment-1"));

      expect(result.current.gate).toBe("already_done");
    },
  );

  it.each(["assigned", "assigned_unfunded", "published", "assignment_pending", "cancelled", "disputed"])(
    "%s: gate es invalid_state (a diferencia de pickup, sin caso especial tipo unfunded)",
    async (status) => {
      (useShipment as jest.Mock).mockReturnValue({
        data: shipment({ status }),
        isLoading: false,
        isError: false,
      });

      const { result } = await renderHook(() => useDeliveryWizard("shipment-1"));

      expect(result.current.gate).toBe("invalid_state");
    },
  );
});
