import { renderHook } from "@testing-library/react-native";

const mockUseMyProfile = jest.fn();
jest.mock("../src/hooks/use-profile", () => ({
  MY_PROFILE_QUERY_KEY: ["profile", "me"],
  useMyProfile: () => mockUseMyProfile(),
}));

const mockInvalidateQueries = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

const mockSignOutDisabledAccount = jest.fn();
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: {
    getState: () => ({ signOutDisabledAccount: mockSignOutDisabledAccount }),
  },
}));

const mockReceivedListeners: ((n: unknown) => void)[] = [];
jest.mock("expo-notifications", () => ({
  addNotificationReceivedListener: (listener: (n: unknown) => void) => {
    mockReceivedListeners.push(listener);
    return { remove: jest.fn() };
  },
}));

import {
  useAccountRestrictionSync,
  useActiveSuspension,
} from "../src/hooks/use-account-restriction";

const FUTURE = "2099-01-01T00:00:00.000Z";

describe("useActiveSuspension (MOVO-300)", () => {
  afterEach(() => jest.clearAllMocks());

  it("devuelve la suspensión vigente del perfil propio", async () => {
    const sanction = { type: "suspension", reason: "Fraude", endsAt: FUTURE };
    mockUseMyProfile.mockReturnValue({ data: { activeSanction: sanction } });

    const { result } = await renderHook(() => useActiveSuspension());

    expect(result.current).toEqual(sanction);
  });

  it("una suspensión vencida o una cuenta activa no cuentan", async () => {
    mockUseMyProfile.mockReturnValue({
      data: {
        activeSanction: {
          type: "suspension",
          reason: "x",
          endsAt: "2020-01-01T00:00:00.000Z",
        },
      },
    });
    expect(
      (await renderHook(() => useActiveSuspension())).result.current,
    ).toBeNull();

    mockUseMyProfile.mockReturnValue({ data: { activeSanction: null } });
    expect(
      (await renderHook(() => useActiveSuspension())).result.current,
    ).toBeNull();
  });
});

describe("useAccountRestrictionSync (MOVO-300)", () => {
  afterEach(() => {
    jest.clearAllMocks();
    mockReceivedListeners.length = 0;
  });

  it("AC4: si el perfil dice que la cuenta está inhabilitada, cierra la sesión", async () => {
    mockUseMyProfile.mockReturnValue({
      data: { accountStatus: "banned", activeSanction: null },
    });

    await renderHook(() => useAccountRestrictionSync());

    expect(mockSignOutDisabledAccount).toHaveBeenCalledTimes(1);
  });

  it("AC6/AC7: un push de sanción recibido con la app abierta refresca el perfil; otro push no", async () => {
    mockUseMyProfile.mockReturnValue({
      data: { accountStatus: "active", activeSanction: null },
    });
    await renderHook(() => useAccountRestrictionSync());
    const listener = mockReceivedListeners[0];

    listener?.({ request: { content: { data: { type: "chat_message" } } } });
    expect(mockInvalidateQueries).not.toHaveBeenCalled();

    listener?.({
      request: { content: { data: { type: "account_sanction_lifted" } } },
    });
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["profile", "me"],
    });
    expect(mockSignOutDisabledAccount).not.toHaveBeenCalled();
  });

  it("AC3: un 403 ACCOUNT_SUSPENDED del cliente HTTP refresca el perfil", async () => {
    mockUseMyProfile.mockReturnValue({
      data: { accountStatus: "active", activeSanction: null },
    });
    // Se registra el listener real del cliente HTTP y se dispara a mano.
    const httpClient = require("../src/api/http-client");
    const register = jest.spyOn(httpClient, "registerAccountSuspendedListener");

    await renderHook(() => useAccountRestrictionSync());
    const listener = register.mock.calls[0]?.[0] as () => void;
    listener();

    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["profile", "me"],
    });
  });
});
