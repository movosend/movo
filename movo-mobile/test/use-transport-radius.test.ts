import { act, renderHook, waitFor } from "@testing-library/react-native";

const mockStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockStore.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockStore.delete(key);
    return Promise.resolve();
  }),
}));

import { DEFAULT_TRANSPORT_RADIUS_KM } from "../src/hooks/use-shipments";
import { useTransportRadius } from "../src/hooks/use-transport-radius";

describe("useTransportRadius", () => {
  beforeEach(() => mockStore.clear());

  it("arranca en el default (50km) sin nada guardado", async () => {
    const { result } = await renderHook(() => useTransportRadius());
    expect(result.current.radiusKm).toBe(DEFAULT_TRANSPORT_RADIUS_KM);
  });

  it("AC3: persiste el radio elegido — sobrevive a un remount del hook (simula reabrir la app)", async () => {
    const { result, unmount } = await renderHook(() => useTransportRadius());

    await act(async () => result.current.setRadiusKm(100));
    expect(result.current.radiusKm).toBe(100);

    unmount();

    const { result: resultAfterRemount } = await renderHook(() => useTransportRadius());
    await waitFor(() => expect(resultAfterRemount.current.radiusKm).toBe(100));
  });
});
