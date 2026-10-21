import { ApiError } from "@movo/shared/dist/errors/api-error";
import { KycStatus } from "@movo/shared/dist/types/user";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import { CarrierRequirementsSheet } from "../components/carrier/carrier-requirements-checklist";
import { useCarrierRequirementsSheet } from "../src/hooks/use-carrier-requirements-sheet";
import { MP_CONNECT_STATUS_QUERY_KEY } from "../src/hooks/use-mp-connect";
import { MY_PROFILE_QUERY_KEY } from "../src/hooks/use-profile";

const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...args: unknown[]) => mockRouterPush(...args) } }));

let mockProfile: { licenseKycStatus: KycStatus } | undefined;
let mockMp: { status: string } | undefined;
jest.mock("../src/hooks/use-profile", () => ({
  MY_PROFILE_QUERY_KEY: ["profile", "me"],
  useMyProfile: () => ({ data: mockProfile }),
}));
jest.mock("../src/hooks/use-mp-connect", () => ({
  MP_CONNECT_STATUS_QUERY_KEY: ["payments", "mp-connect", "status"],
  useMpConnectStatus: () => ({ data: mockMp }),
}));

let lastHandled: boolean | null = null;
let currentError: unknown = null;

function Harness({ context = "offer" as const }) {
  const requirements = useCarrierRequirementsSheet(context);
  return (
    <>
      <Pressable
        testID="trigger"
        onPress={() => {
          lastHandled = requirements.handleError(currentError);
        }}
      >
        <Text>trigger</Text>
      </Pressable>
      <CarrierRequirementsSheet {...requirements.sheetProps} />
    </>
  );
}

function renderHarness(queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe("useCarrierRequirementsSheet (MOVO-117, AC5)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastHandled = null;
    mockProfile = { licenseKycStatus: KycStatus.NOT_STARTED };
    mockMp = { status: "unlinked" };
  });

  it("un 403 con details abre el sheet con todos los faltantes y devuelve true", async () => {
    currentError = new ApiError(403, "CARRIER_LICENSE_NOT_APPROVED", "x", {
      missingRequirements: ["license", "mp_account"],
    });
    const { getByTestId, getByText } = await renderHarness();

    await fireEvent.press(getByTestId("trigger"));

    expect(lastHandled).toBe(true);
    expect(getByText("Te falta completar esto\npara transportar")).toBeTruthy();
    expect(getByTestId("carrier-requirements-sheet-checklist-license-cta")).toBeTruthy();
    expect(getByTestId("carrier-requirements-sheet-checklist-mp-cta")).toBeTruthy();
  });

  it("solo falta MP: el sheet muestra solo ese CTA", async () => {
    currentError = new ApiError(403, "CARRIER_MP_ACCOUNT_NOT_LINKED", "x", { missingRequirements: ["mp_account"] });
    mockProfile = { licenseKycStatus: KycStatus.APPROVED };
    const { getByTestId, queryByTestId } = await renderHarness();

    await fireEvent.press(getByTestId("trigger"));

    expect(lastHandled).toBe(true);
    expect(queryByTestId("carrier-requirements-sheet-checklist-license-cta")).toBeNull();
    expect(getByTestId("carrier-requirements-sheet-checklist-mp-cta")).toBeTruthy();
  });

  it.each([
    new ApiError(502, "PAYMENTS_SERVICE_UNAVAILABLE", "x"),
    new ApiError(502, "USERS_SERVICE_UNAVAILABLE", "x"),
    new ApiError(403, "CARRIER_NOT_VERIFIED", "x"),
    new Error("boom"),
  ])("%p no abre el sheet y devuelve false", async (error) => {
    currentError = error;
    const { getByTestId, queryByTestId } = await renderHarness();

    await fireEvent.press(getByTestId("trigger"));

    expect(lastHandled).toBe(false);
    expect(queryByTestId("carrier-requirements-sheet")).toBeNull();
  });

  it("el 403 invalida perfil y Mercado Pago (el estado del cliente estaba viejo)", async () => {
    currentError = new ApiError(403, "CARRIER_MP_ACCOUNT_NOT_LINKED", "x");
    const queryClient = new QueryClient();
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");
    const { getByTestId } = await renderHarness(queryClient);

    await fireEvent.press(getByTestId("trigger"));

    expect(invalidate).toHaveBeenCalledWith({ queryKey: MY_PROFILE_QUERY_KEY });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: MP_CONNECT_STATUS_QUERY_KEY });
  });

  it("'Después' cierra el sheet", async () => {
    currentError = new ApiError(403, "CARRIER_LICENSE_NOT_APPROVED", "x");
    const { getByTestId, queryByTestId } = await renderHarness();
    await fireEvent.press(getByTestId("trigger"));

    await fireEvent.press(getByTestId("carrier-requirements-sheet-checklist-later"));

    expect(queryByTestId("carrier-requirements-sheet")).toBeNull();
  });

  it("los CTA navegan a /license-kyc (con el status) y /profile/payments, tras cerrarse el sheet", async () => {
    currentError = new ApiError(403, "CARRIER_LICENSE_NOT_APPROVED", "x", {
      missingRequirements: ["license", "mp_account"],
    });
    mockProfile = { licenseKycStatus: KycStatus.REJECTED };
    const { getByTestId } = await renderHarness();
    await fireEvent.press(getByTestId("trigger"));
    await fireEvent.press(getByTestId("carrier-requirements-sheet-checklist-license-cta"));
    await act(async () => {});

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/license-kyc",
      params: { status: KycStatus.REJECTED },
    });

    await fireEvent.press(getByTestId("trigger"));
    await fireEvent.press(getByTestId("carrier-requirements-sheet-checklist-mp-cta"));
    await act(async () => {});

    expect(mockRouterPush).toHaveBeenCalledWith("/profile/payments?tab=methods");
  });

  it("no pasa 'approved' a /license-kyc si el backend dice que la licencia falta (perfil cacheado viejo)", async () => {
    currentError = new ApiError(403, "CARRIER_LICENSE_NOT_APPROVED", "x", {
      missingRequirements: ["license"],
    });
    mockProfile = { licenseKycStatus: KycStatus.APPROVED };
    const { getByTestId } = await renderHarness();
    await fireEvent.press(getByTestId("trigger"));
    await fireEvent.press(getByTestId("carrier-requirements-sheet-checklist-license-cta"));
    await act(async () => {});

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: "/license-kyc",
      params: { status: undefined },
    });
  });
});
