import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react-native";
import { ApiError } from "@movo/shared/dist/errors/api-error";
import * as WebBrowser from "expo-web-browser";
import { useLinkMpAccount } from "../src/hooks/use-mp-connect";
import { paymentsClient } from "../src/api/payments-client";

jest.mock("expo-web-browser", () => ({ openAuthSessionAsync: jest.fn() }));
jest.mock("../src/api/payments-client", () => ({
  paymentsClient: {
    getMpConnectStatus: jest.fn(),
    getMpConnectAuthorizationUrl: jest.fn(),
    unlinkMpAccount: jest.fn(),
  },
}));

const openAuthSession = WebBrowser.openAuthSessionAsync as jest.Mock;
const getStatus = paymentsClient.getMpConnectStatus as jest.Mock;
const getUrl = paymentsClient.getMpConnectAuthorizationUrl as jest.Mock;

type Link = ReturnType<typeof useLinkMpAccount>;

let queryClient: QueryClient;

// Harness en vez de `renderHook` (ver el gotcha de RNTL 14 + React 19 en el CLAUDE.md).
// `gcTime: Infinity` + `clear()`: sin eso el timer de garbage collection de TanStack
// Query deja a Jest sin poder terminar.
async function mountHook() {
  const ref: { current: Link | null } = { current: null };
  function Harness() {
    ref.current = useLinkMpAccount();
    return null;
  }
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  await render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  return ref as { current: Link };
}

describe("useLinkMpAccount (MOVO-112)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getUrl.mockResolvedValue({ authorizationUrl: "https://auth.mercadopago.com/authorization?x=1", expiresAt: "" });
  });

  afterEach(() => {
    queryClient?.clear();
  });

  it("abre el navegador embebido con el deep link de vuelta y sesión efímera (AC2)", async () => {
    openAuthSession.mockResolvedValue({ type: "success", url: "movo://mp-connect?result=success" });
    getStatus.mockResolvedValue({ status: "linked", account: null, invalidReason: null });
    const link = await mountHook();

    await act(async () => {
      await link.current.start();
    });

    expect(openAuthSession).toHaveBeenCalledWith(
      "https://auth.mercadopago.com/authorization?x=1",
      "movo://mp-connect",
      { preferEphemeralSession: true },
    );
    expect(getStatus).toHaveBeenCalledTimes(1);
    expect(link.current.error).toBeNull();
    expect(link.current.phase).toBe("idle");
  });

  it("traduce el código del deep link a un mensaje en español (AC4)", async () => {
    openAuthSession.mockResolvedValue({
      type: "success",
      url: "movo://mp-connect?result=error&code=MP_CONNECT_ACCESS_DENIED",
    });
    getStatus.mockResolvedValue({ status: "unlinked", account: null, invalidReason: null });
    const link = await mountHook();

    await act(async () => {
      await link.current.start();
    });

    expect(link.current.error).toMatch(/No autorizaste a Movo/);
  });

  it("si falla pedir la URL, no abre el navegador y muestra el error de la API", async () => {
    getUrl.mockRejectedValue(new ApiError(503, "MP_CONNECT_NOT_CONFIGURED", ""));
    const link = await mountHook();

    await act(async () => {
      await link.current.start();
    });

    expect(openAuthSession).not.toHaveBeenCalled();
    expect(link.current.error).toMatch(/no está disponible por ahora/);
  });

  it("ignora un segundo toque mientras el primero sigue en curso", async () => {
    let resolveBrowser: (value: unknown) => void = () => {};
    openAuthSession.mockReturnValue(new Promise((resolve) => (resolveBrowser = resolve)));
    getStatus.mockResolvedValue({ status: "unlinked", account: null, invalidReason: null });
    const link = await mountHook();

    let first: Promise<void> = Promise.resolve();
    await act(async () => {
      first = link.current.start();
      await link.current.start();
    });
    await act(async () => {
      resolveBrowser({ type: "cancel" });
      await first;
    });

    expect(getUrl).toHaveBeenCalledTimes(1);
    expect(openAuthSession).toHaveBeenCalledTimes(1);
  });
});
