import { fireEvent, render } from "@testing-library/react-native";
import HomeOperativoGalleryScreen from "../components/dev/HomeOperativoGalleryScreen";

jest.mock("expo-router", () => {
  const { Text } = jest.requireActual("react-native");
  return {
    router: { push: jest.fn() },
    Link: ({ children, testID }: { children: React.ReactNode; testID?: string }) => (
      <Text testID={testID}>{children}</Text>
    ),
  };
});

// `AttentionConfirmCard` (MOVO-193) usa `useAcceptShipment`/`useRejectShipment`
// (TanStack Query), que necesitan un `QueryClientProvider` real — la galería de dev
// no lo trae (vive bajo el `_layout` de la app, ausente en este render aislado), así
// que se mockean igual que en el resto de las pantallas que ejercitan esos hooks.
jest.mock("../src/hooks/use-shipments", () => ({
  useAcceptShipment: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useRejectShipment: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

// Galería de dev (MOVO-193): sin tests en el resto de `components/dev/`
// (dev-tokens/dev-connection), pero acá sí hay comportamiento real (el toggle) que
// vale la pena cubrir con un smoke test — que las 3 piezas se vean con datos y que
// desaparezcan (AC2, "sin envíos no se renderiza") al vaciar el fixture.
describe("HomeOperativoGalleryScreen", () => {
  it("con datos, muestra una card de cada sección y las tareas de atención", async () => {
    const { getByTestId, getByText } = await render(<HomeOperativoGalleryScreen />);

    expect(getByTestId("dev-home-sending")).toBeTruthy();
    expect(getByTestId("dev-home-receiving")).toBeTruthy();
    expect(getByTestId("dev-home-attention")).toBeTruthy();
    expect(getByText("Lucía Gómez retira con este código")).toBeTruthy();
    expect(getByText("Julia te quiere enviar un paquete")).toBeTruthy();
  });

  it("al tocar 'Sin envíos activos', las 3 secciones dejan de renderizarse", async () => {
    const { getByTestId, queryByTestId } = await render(<HomeOperativoGalleryScreen />);

    await fireEvent.press(getByTestId("dev-home-toggle-empty"));

    expect(queryByTestId("dev-home-sending")).toBeNull();
    expect(queryByTestId("dev-home-receiving")).toBeNull();
    expect(queryByTestId("dev-home-attention")).toBeNull();
  });

  it("la CTA de enviar un paquete sigue visible (kyc aprobado)", async () => {
    const { getByTestId } = await render(<HomeOperativoGalleryScreen />);

    expect(getByTestId("dev-home-send-cta")).toBeTruthy();
  });
});
