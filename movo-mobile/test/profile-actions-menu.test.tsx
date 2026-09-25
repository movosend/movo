import { Alert, Keyboard, type AlertButton } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import { ReportReason } from "@movo/shared/dist/types/user";
import { ProfileActionsMenu } from "../components/profile/profile-actions-menu";

type MutateOpts = { onSuccess?: () => void; onError?: (err: unknown) => void };

const mockReportMutate = jest.fn();
const mockBlockMutate = jest.fn();
const mockUnblockMutate = jest.fn();
let mockReportState = { isPending: false };
let mockBlockState = { isPending: false };
let mockReportError: unknown = null;

jest.mock("../src/hooks/use-moderation", () => ({
  useReportUser: (_userId: string, options: { onSuccess?: () => void }) => ({
    mutateAsync: (input: unknown) => {
      mockReportMutate(input);
      if (mockReportError) return Promise.reject(mockReportError);
      options.onSuccess?.();
      return Promise.resolve();
    },
    isPending: mockReportState.isPending,
  }),
  useBlockUser: () => ({
    mutate: (_arg: unknown, opts?: MutateOpts) => mockBlockMutate(opts),
    isPending: mockBlockState.isPending,
  }),
  useUnblockUser: () => ({
    mutate: (userId: string, opts?: MutateOpts) =>
      mockUnblockMutate(userId, opts),
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
            onPress={() =>
              onPressAction?.({ nativeEvent: { event: action.id } })
            }
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
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(
    -1,
  )?.[2] as AlertButton[];
  const confirm = buttons.find((b) => b.style !== "cancel");
  await act(async () => {
    confirm?.onPress?.();
  });
}

describe("ProfileActionsMenu", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReportState = { isPending: false };
    mockBlockState = { isPending: false };
    mockReportError = null;
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
    jest.spyOn(Keyboard, "dismiss").mockImplementation(() => {});
  });

  it("abre el modal de reporte al elegir 'Reportar' del menú", async () => {
    const { getByTestId, getByText } = await render(
      <ProfileActionsMenu
        userId="user-2"
        fullName="Marta González"
        testID="actions"
      />,
    );

    await fireEvent.press(getByTestId("actions-menu-action-report-user"));

    expect(getByTestId("actions-report-modal")).toBeTruthy();
    expect(
      getByText("El equipo de Movo revisa cada reporte. Contanos qué pasó."),
    ).toBeTruthy();
  });

  it("exige elegir un motivo antes de enviar el reporte", async () => {
    const { getByTestId, getByText } = await render(
      <ProfileActionsMenu
        userId="user-2"
        fullName="Marta González"
        testID="actions"
      />,
    );

    await fireEvent.press(getByTestId("actions-menu-action-report-user"));
    await fireEvent.press(getByTestId("actions-report-confirm-button"));

    expect(getByText("Elegí un motivo para continuar.")).toBeTruthy();
    expect(mockReportMutate).not.toHaveBeenCalled();
  });

  it("envía el reporte con el motivo elegido y pasa al estado de éxito", async () => {
    const { getByTestId } = await render(
      <ProfileActionsMenu
        userId="user-2"
        fullName="Marta González"
        testID="actions"
      />,
    );

    await fireEvent.press(getByTestId("actions-menu-action-report-user"));
    await fireEvent.press(
      getByTestId(`actions-reason-${ReportReason.NO_SHOW}`),
    );
    await act(async () => {
      fireEvent.press(getByTestId("actions-report-confirm-button"));
    });

    expect(mockReportMutate).toHaveBeenCalledWith({
      reason: ReportReason.NO_SHOW,
      details: undefined,
    });
    expect(getByTestId("actions-report-success")).toBeTruthy();
    expect(getByTestId("actions-report-success-block-button")).toBeTruthy();
  });

  it("desde el éxito del reporte ofrece bloquear, con confirmación nativa", async () => {
    const onActionSuccess = jest.fn();
    const { getByTestId } = await render(
      <ProfileActionsMenu
        userId="user-2"
        fullName="Marta González"
        onActionSuccess={onActionSuccess}
        testID="actions"
      />,
    );

    await fireEvent.press(getByTestId("actions-menu-action-report-user"));
    await fireEvent.press(
      getByTestId(`actions-reason-${ReportReason.HARASSMENT}`),
    );
    await act(async () => {
      fireEvent.press(getByTestId("actions-report-confirm-button"));
    });
    await fireEvent.press(getByTestId("actions-report-success-block-button"));

    expect(Alert.alert).toHaveBeenCalledWith(
      "¿Bloquear a Marta González?",
      expect.any(String),
      expect.any(Array),
    );
    await confirmLastAlert();
    expect(mockBlockMutate).toHaveBeenCalled();

    const opts = mockBlockMutate.mock.calls[0][0] as MutateOpts;
    await act(async () => {
      opts.onSuccess?.();
    });
    expect(onActionSuccess).toHaveBeenCalledWith(
      "Bloqueaste a Marta González.",
    );
  });

  it("si ya está bloqueado, el éxito del reporte no ofrece bloquear de nuevo", async () => {
    const { getByTestId, queryByTestId } = await render(
      <ProfileActionsMenu
        userId="user-2"
        fullName="Marta González"
        isBlockedByMe
        testID="actions"
      />,
    );

    await fireEvent.press(getByTestId("actions-menu-action-report-user"));
    await fireEvent.press(getByTestId(`actions-reason-${ReportReason.OTHER}`));
    await act(async () => {
      fireEvent.press(getByTestId("actions-report-confirm-button"));
    });

    expect(getByTestId("actions-report-success")).toBeTruthy();
    expect(queryByTestId("actions-report-success-block-button")).toBeNull();
  });

  it("muestra el límite diario de reportes con copy propio y deja el modal abierto", async () => {
    mockReportError = new ApiError(429, "RATE_LIMIT_EXCEEDED", "rate limited");
    const { getByTestId, getByText, queryByTestId } = await render(
      <ProfileActionsMenu
        userId="user-2"
        fullName="Marta González"
        testID="actions"
      />,
    );

    await fireEvent.press(getByTestId("actions-menu-action-report-user"));
    await fireEvent.press(getByTestId(`actions-reason-${ReportReason.OTHER}`));
    await act(async () => {
      fireEvent.press(getByTestId("actions-report-confirm-button"));
    });

    expect(
      getByText("Hiciste demasiados reportes hoy. Probá de nuevo mañana."),
    ).toBeTruthy();
    // Con el teclado abierto la parte de arriba del sheet queda fuera de pantalla:
    // al fallar se cierra el teclado para que el error se vea.
    expect(Keyboard.dismiss).toHaveBeenCalled();
    expect(queryByTestId("actions-report-success")).toBeNull();
  });

  it("pide confirmación nativa antes de bloquear", async () => {
    const { getByTestId } = await render(
      <ProfileActionsMenu
        userId="user-2"
        fullName="Marta González"
        testID="actions"
      />,
    );

    await fireEvent.press(getByTestId("actions-menu-action-block-user"));

    expect(Alert.alert).toHaveBeenCalledWith(
      "¿Bloquear a Marta González?",
      expect.any(String),
      expect.any(Array),
    );
    expect(mockBlockMutate).not.toHaveBeenCalled();
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

    expect(mockUnblockMutate).toHaveBeenCalledWith(
      "user-2",
      expect.any(Object),
    );
    const opts = mockUnblockMutate.mock.calls[0][1] as MutateOpts;
    await act(async () => {
      opts.onSuccess?.();
    });
    expect(onActionSuccess).toHaveBeenCalledWith(
      "Desbloqueaste a Marta González.",
    );
  });

  it("un bloqueo fallido muestra el error traducido", async () => {
    const { getByTestId } = await render(
      <ProfileActionsMenu
        userId="user-2"
        fullName="Marta González"
        testID="actions"
      />,
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
