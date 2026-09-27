import { Alert, type AlertButton } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ReportReason, ReportStatus, type UserReportSummary } from "@movo/shared/dist/types/user";
import { ProfileActionsMenu } from "../components/profile/profile-actions-menu";

type MutateOpts = { onSuccess?: () => void; onError?: (err: unknown) => void };

const mockPush = jest.fn();
const mockBlockMutate = jest.fn();
const mockUnblockMutate = jest.fn();
let mockPendingReport: UserReportSummary | null = null;

jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

jest.mock("../src/hooks/use-moderation", () => ({
  usePendingReport: () => ({ data: mockPendingReport }),
  useBlockUser: () => ({
    mutate: (_arg: unknown, opts?: MutateOpts) => mockBlockMutate(opts),
    isPending: false,
  }),
  useUnblockUser: () => ({
    mutate: (userId: string, opts?: MutateOpts) => mockUnblockMutate(userId, opts),
    isPending: false,
  }),
}));

// Mismo mock que `sender-actions-bar.test.tsx` (MOVO-29): el menú nativo no tiene
// representación en el árbol de React.
jest.mock("@react-native-menu/menu", () => {
  const { Pressable, Text, View } = require("react-native");
  return {
    MenuView: ({ testID, actions, onPressAction, children }: any) => (
      <View testID={testID}>
        <View testID={`${testID}-open`}>{children}</View>
        {actions.map((action: any) => (
          <Pressable
            key={action.id}
            testID={`${testID}-action-${action.id}`}
            onPress={() => onPressAction?.({ nativeEvent: { event: action.id } })}
          >
            <Text>{action.title}</Text>
          </Pressable>
        ))}
      </View>
    ),
  };
});

/** Ejecuta el botón no-cancel del último `Alert.alert` dentro de `act()` (sus
 * callbacks no pasan por ningún evento de RNTL). */
async function confirmLastAlert() {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as AlertButton[];
  const confirm = buttons.find((b) => b.style !== "cancel");
  await act(async () => {
    confirm?.onPress?.();
  });
}

describe("ProfileActionsMenu", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPendingReport = null;
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  it("sin reporte en revisión ofrece reportar y navega a la pantalla de reporte", async () => {
    const { getByTestId, getByText } = await render(
      <ProfileActionsMenu userId="user-2" fullName="Marta González" testID="actions" />,
    );

    expect(getByText("Reportar a Marta González")).toBeTruthy();
    await fireEvent.press(getByTestId("actions-menu-action-report-user"));

    expect(mockPush).toHaveBeenCalledWith("/profile/user-2/report");
  });

  it("con un reporte en revisión ofrece verlo, en la misma pantalla", async () => {
    mockPendingReport = {
      id: "report-1",
      reportedId: "user-2",
      reason: ReportReason.NO_SHOW,
      details: null,
      status: ReportStatus.PENDING,
      createdAt: "2026-09-20T15:00:00.000Z",
      entries: [],
    };
    const { getByTestId, getByText } = await render(
      <ProfileActionsMenu userId="user-2" fullName="Marta González" testID="actions" />,
    );

    expect(getByText("Ver tu reporte")).toBeTruthy();
    await fireEvent.press(getByTestId("actions-menu-action-report-user"));

    expect(mockPush).toHaveBeenCalledWith("/profile/user-2/report");
  });

  it("pide confirmación nativa antes de bloquear y avisa el resultado", async () => {
    const onActionSuccess = jest.fn();
    const { getByTestId } = await render(
      <ProfileActionsMenu
        userId="user-2"
        fullName="Marta González"
        onActionSuccess={onActionSuccess}
        testID="actions"
      />,
    );

    await fireEvent.press(getByTestId("actions-menu-action-block-user"));

    expect(Alert.alert).toHaveBeenCalledWith(
      "¿Bloquear a Marta González?",
      "Podés revertirlo cuando quieras desde Configuración › Cuenta y seguridad › Usuarios bloqueados.",
      expect.any(Array),
    );
    expect(mockBlockMutate).not.toHaveBeenCalled();

    await confirmLastAlert();
    const opts = mockBlockMutate.mock.calls[0][0] as MutateOpts;
    await act(async () => {
      opts.onSuccess?.();
    });
    expect(onActionSuccess).toHaveBeenCalledWith("Bloqueaste a Marta González.");
  });

  it("con isBlockedByMe ofrece 'Desbloquear' en vez de 'Bloquear' y desbloquea tras confirmar", async () => {
    const onActionSuccess = jest.fn();
    const { getByTestId, queryByTestId } = await render(
      <ProfileActionsMenu
        userId="user-2"
        fullName="Marta González"
        isBlockedByMe
        onActionSuccess={onActionSuccess}
        testID="actions"
      />,
    );

    expect(queryByTestId("actions-menu-action-block-user")).toBeNull();
    await fireEvent.press(getByTestId("actions-menu-action-unblock-user"));
    await confirmLastAlert();

    expect(mockUnblockMutate).toHaveBeenCalledWith("user-2", expect.any(Object));
    const opts = mockUnblockMutate.mock.calls[0][1] as MutateOpts;
    await act(async () => {
      opts.onSuccess?.();
    });
    expect(onActionSuccess).toHaveBeenCalledWith("Desbloqueaste a Marta González.");
  });

  it("un bloqueo fallido muestra el error traducido", async () => {
    const { getByTestId } = await render(
      <ProfileActionsMenu userId="user-2" fullName="Marta González" testID="actions" />,
    );

    await fireEvent.press(getByTestId("actions-menu-action-block-user"));
    await confirmLastAlert();
    const opts = mockBlockMutate.mock.calls[0][0] as MutateOpts;
    await act(async () => {
      opts.onError?.(new ApiError(400, "CANNOT_MODERATE_SELF", "self"));
    });

    expect(Alert.alert).toHaveBeenLastCalledWith(
      "No pudimos bloquear",
      "No podés reportarte ni bloquearte a vos mismo.",
    );
  });
});
