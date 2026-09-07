import { Alert } from "react-native";
import { fireEvent, render } from "@testing-library/react-native";
import { ReportReason } from "@movo/shared/dist/types/user";
import { ProfileActionsMenu } from "../components/profile/profile-actions-menu";

const mockReportMutate = jest.fn();
const mockBlockMutate = jest.fn();
let mockReportState = { isPending: false };
let mockBlockState = { isPending: false };

jest.mock("../src/hooks/use-moderation", () => ({
  useReportUser: (_userId: string, options: { onSuccess?: () => void }) => ({
    mutateAsync: (input: unknown) => {
      mockReportMutate(input);
      options.onSuccess?.();
      return Promise.resolve();
    },
    isPending: mockReportState.isPending,
  }),
  useBlockUser: () => ({
    mutate: (_arg: unknown, opts?: { onError?: (err: unknown) => void }) => mockBlockMutate(opts),
    isPending: mockBlockState.isPending,
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

describe("ProfileActionsMenu", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReportState = { isPending: false };
    mockBlockState = { isPending: false };
    jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  it("abre el modal de reporte al elegir 'Reportar' del menú", async () => {
    const { getByTestId, getByText } = await render(
      <ProfileActionsMenu userId="user-2" fullName="Marta González" testID="actions" />
    );

    await fireEvent.press(getByTestId("actions-menu-action-report-user"));

    expect(getByTestId("actions-report-modal")).toBeTruthy();
    expect(getByText("El equipo de Movo revisa cada reporte. Contanos qué pasó.")).toBeTruthy();
  });

  it("exige elegir un motivo antes de enviar el reporte", async () => {
    const { getByTestId, getByText } = await render(
      <ProfileActionsMenu userId="user-2" fullName="Marta González" testID="actions" />
    );

    await fireEvent.press(getByTestId("actions-menu-action-report-user"));
    await fireEvent.press(getByTestId("actions-report-confirm-button"));

    expect(getByText("Elegí un motivo para continuar.")).toBeTruthy();
    expect(mockReportMutate).not.toHaveBeenCalled();
  });

  it("envía el reporte con el motivo elegido", async () => {
    const { getByTestId } = await render(
      <ProfileActionsMenu userId="user-2" fullName="Marta González" testID="actions" />
    );

    await fireEvent.press(getByTestId("actions-menu-action-report-user"));
    await fireEvent.press(getByTestId(`actions-reason-${ReportReason.NO_SHOW}`));
    await fireEvent.press(getByTestId("actions-report-confirm-button"));

    expect(mockReportMutate).toHaveBeenCalledWith({ reason: ReportReason.NO_SHOW, details: undefined });
  });

  it("pide confirmación nativa antes de bloquear", async () => {
    const { getByTestId } = await render(
      <ProfileActionsMenu userId="user-2" fullName="Marta González" testID="actions" />
    );

    await fireEvent.press(getByTestId("actions-menu-action-block-user"));

    expect(Alert.alert).toHaveBeenCalledWith(
      "¿Bloquear a Marta González?",
      expect.any(String),
      expect.any(Array),
    );
    expect(mockBlockMutate).not.toHaveBeenCalled();
  });
});
