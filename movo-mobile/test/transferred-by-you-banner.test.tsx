import type { ReceiverTransferRequest } from "@movo/shared/dist/types/receiver-transfer";
import { render } from "@testing-library/react-native";
import { TransferredByYouBanner } from "../components/shipments/transferred-by-you-banner";

const mockProfile = jest.fn();
jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: () => mockProfile(),
}));

const transfer: ReceiverTransferRequest = {
  id: "tr-1",
  shipmentId: "s-1",
  requestedBy: "lucia",
  requesterName: "Lucía Gómez",
  newReceiverId: "martin",
  newReceiverName: "Martín López",
  reason: "Esa semana estoy de viaje",
  responseReason: null,
  status: "completed",
  cancelReason: null,
  newReceiverDeadline: "2026-10-10T18:00:00.000Z",
  createdAt: "2026-10-10T12:00:00.000Z",
  resolvedAt: "2026-10-10T12:20:00.000Z",
  resolvedBy: "martin",
};

describe("TransferredByYouBanner (MOVO-275)", () => {
  it("muestra la foto real de quien recibe ahora", async () => {
    mockProfile.mockReturnValue({ data: { fullName: "Martín López", photoUrl: "https://cdn/martin.jpg" } });

    const { getByTestId, queryByTestId } = await render(<TransferredByYouBanner transfer={transfer} testID="banner" />);

    expect(getByTestId("banner-avatar-photo")).toBeTruthy();
    expect(queryByTestId("banner-avatar-initials")).toBeNull();
  });

  it("sin foto, muestra sus iniciales, y la fecha con día, hora y 'a las'", async () => {
    mockProfile.mockReturnValue({ data: { fullName: "Martín López", photoUrl: null } });

    const { getByTestId } = await render(<TransferredByYouBanner transfer={transfer} testID="banner" />);

    expect(getByTestId("banner-avatar-initials")).toHaveTextContent("ML");
    expect(getByTestId("banner-date")).toHaveTextContent(/^Aceptó el \S+ 10 oct a las \d{2}:\d{2}$/);
  });
});
