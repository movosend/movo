import type { SupportConversationItem } from "@movo/shared/dist/types/support";
import { fireEvent, render } from "@testing-library/react-native";
import { router } from "expo-router";
import SupportConversationsScreen from "../app/(app)/support/conversations";
import { resetNavigationGuard } from "../src/lib/navigation-guard";

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
  useFocusEffect: (callback: () => void) => {
    const { useEffect } = require("react");
    useEffect(callback, []);
  },
}));

const mockUseSupportList = jest.fn();
jest.mock("../src/hooks/use-support", () => ({ useSupportList: () => mockUseSupportList() }));

const { ApiError } = jest.requireActual("@movo/shared/dist/errors/api-error");

function item(over: Partial<SupportConversationItem> = {}): SupportConversationItem {
  return {
    id: "c1",
    code: "SOP-1048",
    topic: "payments",
    status: "awaiting_user",
    shipment: null,
    unreadCount: 2,
    lastActivityAt: new Date().toISOString(),
    lastMessage: { from: "agent", authorName: "Lucía", body: "¿Me pasás el comprobante?", hasAttachments: false, createdAt: new Date().toISOString() },
    ...over,
  };
}

const base = { isLoading: false, isError: false, error: null, refetch: jest.fn(), isRefetching: false };

describe("SupportConversationsScreen (MOVO-324)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetNavigationGuard();
  });

  it("lista las consultas con tema, estado, código, último mensaje con su autor y contador de no leídos", async () => {
    mockUseSupportList.mockReturnValue({ ...base, data: [item()] });
    const { getByText, getByTestId } = await render(<SupportConversationsScreen />);

    expect(getByText("Soporte")).toBeTruthy();
    expect(getByText("El equipo de Movo te responde por acá.")).toBeTruthy();
    expect(getByText("Mis consultas")).toBeTruthy();
    expect(getByText("Pagos")).toBeTruthy();
    expect(getByText("Esperando tu respuesta")).toBeTruthy();
    expect(getByText("SOP-1048")).toBeTruthy();
    expect(getByText("Movo: ¿Me pasás el comprobante?")).toBeTruthy();
    expect(getByTestId("support-row-c1-unread")).toHaveTextContent("2");
  });

  it("muestra el envío vinculado y 'Vos:' / 'Foto' en la vista previa", async () => {
    mockUseSupportList.mockReturnValue({
      ...base,
      data: [
        item({ id: "c2", unreadCount: 0, shipment: { id: "s1", code: "MOVO-48213" }, lastMessage: { from: "user", authorName: null, body: "Sí, hay portero", hasAttachments: false, createdAt: "x" } }),
        item({ id: "c3", unreadCount: 0, status: "resolved", lastMessage: { from: "agent", authorName: "Tomás", body: "", hasAttachments: true, createdAt: "x" } }),
      ],
    });
    const { getByText, queryByTestId } = await render(<SupportConversationsScreen />);

    expect(getByText("Envío · MOVO-48213")).toBeTruthy();
    expect(getByText("Vos: Sí, hay portero")).toBeTruthy();
    expect(getByText("Movo: Foto")).toBeTruthy();
    expect(getByText("Resuelta")).toBeTruthy();
    expect(queryByTestId("support-row-c2-unread")).toBeNull();
  });

  it("vacío: 'Todavía no hiciste ninguna consulta' y el botón Nueva consulta sigue disponible", async () => {
    mockUseSupportList.mockReturnValue({ ...base, data: [] });
    const { getByTestId, getByText } = await render(<SupportConversationsScreen />);

    expect(getByTestId("support-empty")).toBeTruthy();
    expect(getByText("Todavía no hiciste ninguna consulta")).toBeTruthy();
    expect(getByTestId("support-new")).toBeTruthy();
  });

  it("'Nueva consulta' abre el formulario", async () => {
    mockUseSupportList.mockReturnValue({ ...base, data: [] });
    const { getByTestId } = await render(<SupportConversationsScreen />);

    await fireEvent.press(getByTestId("support-new"));

    expect(router.push).toHaveBeenCalledWith("/support/new");
  });

  it("tocar una consulta abre su conversación", async () => {
    mockUseSupportList.mockReturnValue({ ...base, data: [item()] });
    const { getByTestId } = await render(<SupportConversationsScreen />);

    await fireEvent.press(getByTestId("support-row-c1"));

    expect(router.push).toHaveBeenCalledWith("/support/c1");
  });

  it("cargando: esqueleto, sin lista ni vacío", async () => {
    mockUseSupportList.mockReturnValue({ ...base, isLoading: true, data: undefined });
    const { getByTestId, queryByTestId } = await render(<SupportConversationsScreen />);

    expect(getByTestId("support-loading")).toBeTruthy();
    expect(queryByTestId("support-empty")).toBeNull();
  });

  it("error: mensaje traducido y reintento", async () => {
    const refetch = jest.fn();
    mockUseSupportList.mockReturnValue({ ...base, isError: true, error: new ApiError(500, "INTERNAL_ERROR", "x"), refetch, data: undefined });
    const { getByTestId } = await render(<SupportConversationsScreen />);

    expect(getByTestId("support-error")).toBeTruthy();
    await fireEvent.press(getByTestId("support-retry"));
    expect(refetch).toHaveBeenCalled();
  });

  it("un VALIDATION_FAILED (backend sin el endpoint) no muestra 'Revisá los datos ingresados'", async () => {
    mockUseSupportList.mockReturnValue({ ...base, isError: true, error: new ApiError(400, "VALIDATION_FAILED", "x"), data: undefined });
    const { getByTestId } = await render(<SupportConversationsScreen />);

    expect(getByTestId("support-error")).toHaveTextContent(/No pudimos cargar tus consultas/);
  });

  it("al enfocar la pantalla vuelve a pedir la lista", async () => {
    const refetch = jest.fn();
    mockUseSupportList.mockReturnValue({ ...base, data: [], refetch });
    await render(<SupportConversationsScreen />);
    expect(refetch).toHaveBeenCalled();
  });
});
