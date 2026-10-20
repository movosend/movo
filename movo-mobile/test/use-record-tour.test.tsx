import type { PrivateProfile } from "@movo/shared/dist/types/user-profile";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { usersClient } from "../src/api/users-client";
import { MY_PROFILE_QUERY_KEY } from "../src/hooks/use-profile";
import { usePendingToursFlush, useRecordTour } from "../src/hooks/use-record-tour";
import { useTourStore } from "../src/store/tour-store";

const mockStorage = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockStorage.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockStorage.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockStorage.delete(key);
    return Promise.resolve();
  }),
}));

jest.mock("../src/api/users-client", () => ({
  ...jest.requireActual("../src/api/users-client"),
  usersClient: { recordTour: jest.fn() },
}));
const mockRecordTour = usersClient.recordTour as jest.Mock;

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (s: { user: { userId: string } }) => unknown) => selector({ user: { userId: "user-1" } }),
}));

const PENDING_KEY = "movo.tours.pending.user-1";
const RECORD = { tourId: "first_steps", version: 1, outcome: "skipped" } as const;

function setup() {
  // `gcTime: Infinity`: sin timers de recolección colgados, Jest sale al terminar.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } },
  });
  queryClient.setQueryData(MY_PROFILE_QUERY_KEY, { id: "user-1", tours: [] } as unknown as PrivateProfile);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

function cachedTours(queryClient: QueryClient) {
  return queryClient.getQueryData<PrivateProfile>(MY_PROFILE_QUERY_KEY)?.tours;
}

describe("useRecordTour / usePendingToursFlush (MOVO-169)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStorage.clear();
    useTourStore.setState({ active: null, anchors: {}, pending: [], pendingLoaded: false });
  });

  it("actualiza el perfil cacheado antes de que responda el PUT y limpia el pendiente al confirmar", async () => {
    let resolvePut: (value: unknown) => void = () => undefined;
    mockRecordTour.mockReturnValue(new Promise((resolve) => (resolvePut = resolve)));
    const { queryClient, wrapper } = setup();
    const { result } = await renderHook(() => useRecordTour(), { wrapper });

    await act(async () => {
      result.current.mutate(RECORD);
    });

    expect(cachedTours(queryClient)).toEqual([RECORD]);
    expect(useTourStore.getState().pending).toEqual([RECORD]);
    await waitFor(() => expect(mockStorage.get(PENDING_KEY)).toBe(JSON.stringify([RECORD])));
    expect(mockRecordTour).toHaveBeenCalledWith("first_steps", { version: 1, outcome: "skipped" });

    await act(async () => {
      resolvePut(RECORD);
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockStorage.has(PENDING_KEY)).toBe(false);
    expect(useTourStore.getState().pending).toEqual([]);
  });

  it("si el PUT falla el registro queda pendiente: el tour sigue contando como visto", async () => {
    mockRecordTour.mockRejectedValue(new Error("sin red"));
    const { queryClient, wrapper } = setup();
    const { result } = await renderHook(() => useRecordTour(), { wrapper });

    await act(async () => {
      result.current.mutate(RECORD);
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(cachedTours(queryClient)).toEqual([RECORD]);
    expect(useTourStore.getState().pending).toEqual([RECORD]);
    expect(mockStorage.get(PENDING_KEY)).toBe(JSON.stringify([RECORD]));
  });

  it("al arrancar reintenta los pendientes guardados y los borra si el backend confirma", async () => {
    mockStorage.set(PENDING_KEY, JSON.stringify([RECORD]));
    mockRecordTour.mockResolvedValue(RECORD);
    const { queryClient, wrapper } = setup();

    await renderHook(() => usePendingToursFlush(), { wrapper });

    await waitFor(() => expect(mockStorage.has(PENDING_KEY)).toBe(false));
    expect(mockRecordTour).toHaveBeenCalledWith("first_steps", { version: 1, outcome: "skipped" });
    expect(useTourStore.getState().pendingLoaded).toBe(true);
    expect(useTourStore.getState().pending).toEqual([]);
    expect(cachedTours(queryClient)).toEqual([RECORD]);
  });

  it("si el reintento vuelve a fallar, el pendiente sigue guardado para el próximo arranque", async () => {
    mockStorage.set(PENDING_KEY, JSON.stringify([RECORD]));
    mockRecordTour.mockRejectedValue(new Error("sin red"));
    const { wrapper } = setup();

    await renderHook(() => usePendingToursFlush(), { wrapper });

    await waitFor(() => expect(mockRecordTour).toHaveBeenCalled());
    expect(useTourStore.getState().pendingLoaded).toBe(true);
    expect(useTourStore.getState().pending).toEqual([RECORD]);
    expect(mockStorage.get(PENDING_KEY)).toBe(JSON.stringify([RECORD]));
  });
});
