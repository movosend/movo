import { fireEvent, render, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import NewSupportRequestScreen from "../app/(app)/support/new";
import { resetNavigationGuard } from "../src/lib/navigation-guard";
import { useSupportDraftStore } from "../src/store/support-draft-store";

let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => {
  const { View } = require("react-native");
  return {
    router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true },
    Stack: { Screen: () => <View /> },
    useLocalSearchParams: () => mockParams,
  };
});
jest.mock("expo-crypto", () => ({ randomUUID: () => "uuid-form" }));

const shipments = [
  { id: "s1", code: "MOVO-48213", status: "in_transit", route: "Palermo → Quilmes", role: "sender", createdAt: "2026-10-18T10:00:00.000Z" },
  { id: "s2", code: "MOVO-48176", status: "delivered", route: "Güemes → Cofico", role: "carrier", createdAt: "2026-10-10T10:00:00.000Z" },
];
let mockHasNextPage = false;
const mockFetchNextPage = jest.fn();
jest.mock("../src/hooks/use-support", () => ({
  useSupportShipments: () => ({
    data: { pages: [{ items: shipments, nextCursor: null }] },
    isLoading: false,
    hasNextPage: mockHasNextPage,
    fetchNextPage: () => mockFetchNextPage(),
  }),
}));

let mockPhotos: Record<string, unknown>;
jest.mock("../src/hooks/use-support-photos", () => ({ useSupportPhotos: () => mockPhotos }));

function photosState(over: Record<string, unknown> = {}) {
  return { photos: [], add: jest.fn(), retry: jest.fn(), remove: jest.fn(), reset: jest.fn(), uploadedIds: [], canAddMore: true, hasPending: false, max: 4, ...over };
}

const pickTopic = async (api: { getByTestId: (id: string) => unknown }, label: string) => {
  await fireEvent.press(api.getByTestId("support-topic") as never);
  await fireEvent.press(api.getByTestId(`support-topic-option-${label}`) as never);
};

describe("NewSupportRequestScreen (MOVO-324)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetNavigationGuard();
    mockParams = {};
    mockHasNextPage = false;
    mockPhotos = photosState();
    useSupportDraftStore.setState({ draft: null });
  });

  it("'Enviar consulta' queda deshabilitado sin tema y sin texto", async () => {
    const { getByTestId } = await render(<NewSupportRequestScreen />);
    expect(getByTestId("support-submit").props.accessibilityState.disabled).toBe(true);

    await pickTopic({ getByTestId }, "Pagos");
    expect(getByTestId("support-submit").props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(getByTestId("support-text"), "x");
    expect(getByTestId("support-submit").props.accessibilityState.disabled).toBe(false);
  });

  it("los temas son los cinco del ticket y se elige uno solo", async () => {
    const { getByText, getByTestId } = await render(<NewSupportRequestScreen />);
    await fireEvent.press(getByTestId("support-topic"));
    ["Envío", "Pagos", "Mi cuenta", "Ser transportista", "Seguridad"].forEach((label) => expect(getByText(label)).toBeTruthy());

    await fireEvent.press(getByTestId("support-topic-option-Pagos"));
    expect(getByText("Pagos")).toBeTruthy();
  });

  it("el selector de envío solo se muestra con el tema Envío", async () => {
    const { getByTestId, queryByTestId } = await render(<NewSupportRequestScreen />);
    expect(queryByTestId("support-shipment-select")).toBeNull();

    await pickTopic({ getByTestId }, "Pagos");
    expect(queryByTestId("support-shipment-select")).toBeNull();

    await pickTopic({ getByTestId }, "Envío");
    expect(getByTestId("support-shipment-select")).toBeTruthy();

    await pickTopic({ getByTestId }, "Mi cuenta");
    expect(queryByTestId("support-shipment-select")).toBeNull();
  });

  it("sin envío elegido: 'No es sobre un envío' por defecto y la consulta se manda sin shipmentId", async () => {
    const { getByTestId, getByText } = await render(<NewSupportRequestScreen />);
    await pickTopic({ getByTestId }, "Envío");
    expect(getByText("No es sobre un envío")).toBeTruthy();
    await pickTopic({ getByTestId }, "Pagos");
    await fireEvent.changeText(getByTestId("support-text"), "  Me cobraron dos veces  ");
    await fireEvent.press(getByTestId("support-submit"));

    const draft = useSupportDraftStore.getState().draft;
    expect(draft).toMatchObject({ topic: "payments", body: "Me cobraron dos veces", clientMessageId: "uuid-form", shipment: null, attachments: [] });
    expect(router.replace).toHaveBeenCalledWith("/support/pending");
  });

  it("vincula un envío elegido de la lista (cualquier rol) y lo manda en el borrador", async () => {
    const { getByTestId, findByTestId } = await render(<NewSupportRequestScreen />);
    await pickTopic({ getByTestId }, "Envío");
    await fireEvent.press(getByTestId("support-shipment-select"));

    // Las dos filas: emisor y transportista.
    expect(await findByTestId("support-shipment-select-option-s1")).toBeTruthy();
    await fireEvent.press(await findByTestId("support-shipment-select-option-s2"));

    await fireEvent.changeText(getByTestId("support-text"), "Llegó abierto");
    await fireEvent.press(getByTestId("support-submit"));

    expect(useSupportDraftStore.getState().draft?.shipment).toEqual({ id: "s2", code: "MOVO-48176" });
  });

  it("se puede volver a 'No es sobre un envío' después de elegir uno", async () => {
    const { getByTestId, findByTestId, getAllByText } = await render(<NewSupportRequestScreen />);
    await pickTopic({ getByTestId }, "Envío");
    await fireEvent.press(getByTestId("support-shipment-select"));
    await fireEvent.press(await findByTestId("support-shipment-select-option-s1"));

    await fireEvent.press(getByTestId("support-shipment-select"));
    await fireEvent.press(await findByTestId("support-shipment-select-none"));

    expect(getAllByText("No es sobre un envío").length).toBeGreaterThan(0);
  });

  it("abierta desde el detalle de un envío llega con tema Envío y el envío ya vinculado", async () => {
    mockParams = { shipmentId: "s1" };
    const { getByTestId, getByText } = await render(<NewSupportRequestScreen />);

    expect(getByText("Envío")).toBeTruthy();
    expect(getByText("MOVO-48213 · En camino")).toBeTruthy();

    await fireEvent.changeText(getByTestId("support-text"), "Falta un libro");
    await fireEvent.press(getByTestId("support-submit"));
    expect(useSupportDraftStore.getState().draft?.shipment?.id).toBe("s1");
  });

  it("con un envío que no está en la primera página igual lo muestra por su código", async () => {
    mockParams = { shipmentId: "99999-12345" };
    const { getByText } = await render(<NewSupportRequestScreen />);
    expect(getByText("MOVO-12345")).toBeTruthy();
  });

  it("'Ver más envíos' pide la página siguiente", async () => {
    mockHasNextPage = true;
    const { getByTestId, findByTestId } = await render(<NewSupportRequestScreen />);
    await pickTopic({ getByTestId }, "Envío");
    await fireEvent.press(getByTestId("support-shipment-select"));

    await fireEvent.press(await findByTestId("support-shipment-select-more"));

    expect(mockFetchNextPage).toHaveBeenCalled();
  });

  it("el contador aparece desde los 1.800 caracteres", async () => {
    const { getByTestId, queryByTestId } = await render(<NewSupportRequestScreen />);
    await fireEvent.changeText(getByTestId("support-text"), "a".repeat(1799));
    expect(queryByTestId("support-text-counter")).toBeNull();

    await fireEvent.changeText(getByTestId("support-text"), "a".repeat(1800));
    expect(getByTestId("support-text-counter")).toHaveTextContent("1.800 de 2.000");
  });

  it("fotos: el borrador lleva solo las subidas y una foto subiendo bloquea el envío", async () => {
    mockPhotos = photosState({
      photos: [
        { id: "p1", localUri: "file:///a.jpg", status: "uploaded", attachmentId: "att-1", errorMessage: null },
        { id: "p2", localUri: "file:///b.jpg", status: "uploading", attachmentId: null, errorMessage: null },
      ],
      hasPending: true,
    });
    const { getByTestId, rerender } = await render(<NewSupportRequestScreen />);
    await pickTopic({ getByTestId }, "Mi cuenta");
    await fireEvent.changeText(getByTestId("support-text"), "Con fotos");
    expect(getByTestId("support-submit").props.accessibilityState.disabled).toBe(true);

    mockPhotos = photosState({
      photos: [{ id: "p1", localUri: "file:///a.jpg", status: "uploaded", attachmentId: "att-1", errorMessage: null }],
    });
    await rerender(<NewSupportRequestScreen />);
    await fireEvent.press(getByTestId("support-submit"));

    await waitFor(() => expect(useSupportDraftStore.getState().draft?.attachments).toEqual([{ attachmentId: "att-1", localUri: "file:///a.jpg" }]));
  });

  it("con 4 fotos desaparece el botón 'Agregar'", async () => {
    mockPhotos = photosState({
      photos: [1, 2, 3, 4].map((n) => ({ id: `p${n}`, localUri: `file:///${n}.jpg`, status: "uploaded", attachmentId: `att-${n}`, errorMessage: null })),
      canAddMore: false,
    });
    const { queryByTestId, getByTestId } = await render(<NewSupportRequestScreen />);

    expect(queryByTestId("support-add-photo")).toBeNull();
    expect(getByTestId("support-draft-photos-count")).toHaveTextContent("4/4");
  });

  it("el botón de agregar foto abre el selector", async () => {
    const { getByTestId } = await render(<NewSupportRequestScreen />);
    await fireEvent.press(getByTestId("support-add-photo"));
    expect((mockPhotos.add as jest.Mock)).toHaveBeenCalled();
  });

  it("cerrar vuelve atrás", async () => {
    const { getByTestId } = await render(<NewSupportRequestScreen />);
    await fireEvent.press(getByTestId("support-new-close"));
    expect(router.back).toHaveBeenCalled();
  });
});
