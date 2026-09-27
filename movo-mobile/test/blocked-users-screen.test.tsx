import { Alert, type AlertButton } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import BlockedUsersScreen from "../app/(app)/profile/blocked-users";

type MutateOpts = { onSuccess?: () => void; onError?: (err: unknown) => void };

const mockUnblockMutate = jest.fn();
const mockRefetch = jest.fn();
let mockBlockedState: { data?: unknown; isLoading: boolean; isError: boolean } =
  {
    data: [],
    isLoading: false,
    isError: false,
  };

jest.mock("../src/hooks/use-moderation", () => ({
  useBlockedUsers: () => ({ ...mockBlockedState, refetch: mockRefetch }),
  useUnblockUser: () => ({
    mutate: (userId: string, opts?: MutateOpts) =>
      mockUnblockMutate(userId, opts),
    isPending: false,
  }),
}));

jest.mock("expo-router", () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));

const MARTA = {
  id: "user-2",
  fullName: "Marta González",
  photoUrl: null,
  blockedAt: "2026-09-25T10:00:00.000Z",
};
const PEDRO = {
  id: "user-3",
  fullName: "Pedro Yorlano",
  photoUrl: null,
  blockedAt: "2026-09-24T10:00:00.000Z",
};

describe("BlockedUsersScreen (MOVO-175)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBlockedState = { data: [], isLoading: false, isError: false };
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  it("muestra el estado vacío sin bloqueos, con la explicación de qué implica bloquear", async () => {
    const { getByTestId } = await render(<BlockedUsersScreen />);
    expect(getByTestId("blocked-users-empty")).toBeTruthy();
    expect(getByTestId("block-implications-card")).toBeTruthy();
  });

  it("mantiene la explicación arriba cuando hay bloqueados", async () => {
    mockBlockedState = { data: [MARTA], isLoading: false, isError: false };
    const { getByTestId } = await render(<BlockedUsersScreen />);
    expect(getByTestId("block-implications-card")).toBeTruthy();
    expect(getByTestId("blocked-users-row-user-2")).toBeTruthy();
  });

  it("lista a los usuarios bloqueados", async () => {
    mockBlockedState = {
      data: [MARTA, PEDRO],
      isLoading: false,
      isError: false,
    };
    const { getByTestId, getByText } = await render(<BlockedUsersScreen />);

    expect(getByTestId("blocked-users-row-user-2")).toBeTruthy();
    expect(getByTestId("blocked-users-row-user-3")).toBeTruthy();
    expect(getByText("Marta González")).toBeTruthy();
  });

  it("desbloquea tras confirmar y muestra el aviso de éxito", async () => {
    mockBlockedState = { data: [MARTA], isLoading: false, isError: false };
    const { getByTestId } = await render(<BlockedUsersScreen />);

    await fireEvent.press(getByTestId("blocked-users-row-user-2-unblock"));
    expect(Alert.alert).toHaveBeenCalledWith(
      "¿Desbloquear a Marta González?",
      expect.any(String),
      expect.any(Array),
    );
    expect(mockUnblockMutate).not.toHaveBeenCalled();

    const buttons = (Alert.alert as jest.Mock).mock.calls.at(
      -1,
    )[2] as AlertButton[];
    await act(async () => {
      buttons.find((b) => b.style !== "cancel")?.onPress?.();
    });
    expect(mockUnblockMutate).toHaveBeenCalledWith(
      "user-2",
      expect.any(Object),
    );

    const opts = mockUnblockMutate.mock.calls[0][1] as MutateOpts;
    await act(async () => {
      opts.onSuccess?.();
    });
    expect(getByTestId("blocked-users-success")).toBeTruthy();
  });

  it("ante un error de carga ofrece reintentar", async () => {
    mockBlockedState = { data: undefined, isLoading: false, isError: true };
    const { getByTestId } = await render(<BlockedUsersScreen />);

    await fireEvent.press(getByTestId("blocked-users-retry"));
    expect(mockRefetch).toHaveBeenCalled();
  });
});
