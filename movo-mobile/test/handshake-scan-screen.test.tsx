import { act, fireEvent, render } from "@testing-library/react-native";

jest.mock("expo-router", () => ({
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: () => true },
  useLocalSearchParams: () => ({ id: "shipment-1" }),
}));

const mockShipment = { id: "shipment-1", status: "in_transit", senderId: "sender-1", receiverId: "receiver-1", carrierId: "carrier-1" };
jest.mock("../src/hooks/use-shipments", () => ({ useShipment: () => ({ data: mockShipment }) }));

let mockRatings: { rateeId: string; score: number }[] = [];
jest.mock("../src/hooks/use-ratings", () => ({ useShipmentRatings: () => ({ data: mockRatings }) }));
jest.mock("../src/hooks/use-profile", () => ({
  usePublicProfile: (id?: string) => ({ data: id ? { fullName: "Juan Cruz", photoUrl: null } : undefined }),
}));

const deliveryResult = {
  shipmentId: "shipment-1",
  stage: "delivery" as const,
  previousStatus: "in_transit" as const,
  status: "delivered" as const,
  distanceM: 0,
  confirmedAt: "2026-11-09T17:48:00.000Z",
};
jest.mock("../components/handshake/handshake-scan-step", () => {
  const { Pressable, Text } = require("react-native");
  return {
    HandshakeScanStep: (props: { onConfirmed: (r: unknown) => void }) => (
      <Pressable testID="mock-confirm" onPress={() => props.onConfirmed(mockConfirmResult)}>
        <Text>scan</Text>
      </Pressable>
    ),
  };
});
let mockConfirmResult: unknown = deliveryResult;

jest.mock("../components/handshake/handshake-confirmation-result", () => {
  const { Pressable, Text, View } = require("react-native");
  return {
    HandshakeConfirmationResult: (props: any) => (
      <View>
        {props.secondaryCtas?.map((cta: { id: string; label: string; onPress: () => void }) => (
          <Pressable key={cta.id} testID={`${props.testID}-secondary-cta-${cta.id}`} onPress={cta.onPress}>
            <Text>{cta.label}</Text>
          </Pressable>
        ))}
      </View>
    ),
  };
});

let mockRatingSheetProps: { target: unknown; visible: boolean } | null = null;
jest.mock("../components/shipments/rating-sheet", () => {
  const { View } = require("react-native");
  return {
    RatingSheet: (props: any) => {
      mockRatingSheetProps = props;
      return <View testID={props.testID} />;
    },
  };
});

import HandshakeScanScreen from "../app/(app)/shipments/[id]/handshake-scan";

describe("HandshakeScanScreen: calificar al transportista al recibir", () => {
  beforeEach(() => {
    mockRatings = [];
    mockRatingSheetProps = null;
    mockConfirmResult = deliveryResult;
  });

  it("en la entrega ofrece calificar al transportista y abre la hoja con él", async () => {
    const { getByTestId } = await render(<HandshakeScanScreen />);
    await act(async () => fireEvent.press(getByTestId("mock-confirm")));

    const cta = getByTestId("handshake-confirmation-result-secondary-cta-carrier");
    expect(cta).toHaveTextContent("Calificar al transportista");
    await act(async () => fireEvent.press(cta));

    expect(mockRatingSheetProps?.visible).toBe(true);
    expect(mockRatingSheetProps?.target).toEqual(
      expect.objectContaining({ userId: "carrier-1", fullName: "Juan Cruz", rateeRole: "carrier" }),
    );
  });

  it("si ya lo calificó, el botón lo dice", async () => {
    mockRatings = [{ rateeId: "carrier-1", score: 4 }];
    const { getByTestId } = await render(<HandshakeScanScreen />);
    await act(async () => fireEvent.press(getByTestId("mock-confirm")));

    expect(getByTestId("handshake-confirmation-result-secondary-cta-carrier")).toHaveTextContent(
      "Ya calificaste al transportista",
    );
  });

  it("en el retiro no hay botón de calificar", async () => {
    mockConfirmResult = { ...deliveryResult, stage: "pickup", previousStatus: "assigned", status: "in_transit" };
    const { getByTestId, queryByTestId } = await render(<HandshakeScanScreen />);
    await act(async () => fireEvent.press(getByTestId("mock-confirm")));

    expect(queryByTestId("handshake-confirmation-result-secondary-cta-carrier")).toBeNull();
  });
});
