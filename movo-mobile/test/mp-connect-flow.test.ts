import type { WebBrowserAuthSessionResult } from "expo-web-browser";
import {
  LINK_CANCELLED_MESSAGE,
  LINK_UNCONFIRMED_MESSAGE,
  parseAuthSessionResult,
  resolveLinkOutcome,
  runMpConnectLink,
} from "../src/lib/mp-connect-flow";
import { formatMpConnectedAt } from "../src/lib/mp-connect-format";

const success = (url: string) => ({ type: "success", url }) as WebBrowserAuthSessionResult;
const closed = (type: "cancel" | "dismiss") => ({ type }) as WebBrowserAuthSessionResult;

describe("parseAuthSessionResult (MOVO-112)", () => {
  it("lee result=success del deep link", () => {
    expect(parseAuthSessionResult(success("movo://mp-connect?result=success"))).toEqual({
      kind: "returned",
      result: "success",
    });
  });

  it("lee result=error con un código conocido", () => {
    expect(
      parseAuthSessionResult(success("movo://mp-connect?result=error&code=MP_CONNECT_ACCESS_DENIED")),
    ).toEqual({ kind: "returned", result: "error", code: "MP_CONNECT_ACCESS_DENIED" });
  });

  it("descarta un código desconocido en vez de pasarlo como si fuera del contrato", () => {
    expect(parseAuthSessionResult(success("movo://mp-connect?result=error&code=LO_QUE_SEA"))).toEqual({
      kind: "returned",
      result: "error",
      code: null,
    });
  });

  it("trata un deep link sin params como error sin código", () => {
    expect(parseAuthSessionResult(success("movo://mp-connect"))).toEqual({
      kind: "returned",
      result: "error",
      code: null,
    });
  });

  it.each(["cancel", "dismiss"] as const)("'%s' cuenta como navegador cerrado", (type) => {
    expect(parseAuthSessionResult(closed(type))).toEqual({ kind: "closed" });
  });
});

describe("resolveLinkOutcome (MOVO-112): manda el status, no el deep link", () => {
  it("success + status linked → vinculada, sin error (AC3)", () => {
    expect(resolveLinkOutcome({ kind: "returned", result: "success" }, "linked")).toEqual({ kind: "linked" });
  });

  it("success + status no linked → error de confirmación (no se confía en el deep link)", () => {
    expect(resolveLinkOutcome({ kind: "returned", result: "success" }, "unlinked")).toEqual({
      kind: "error",
      code: null,
      fallbackMessage: LINK_UNCONFIRMED_MESSAGE,
    });
  });

  it("error con código → muestra el código, sin importar el status previo (AC4)", () => {
    expect(
      resolveLinkOutcome({ kind: "returned", result: "error", code: "MP_CONNECT_EXCHANGE_FAILED" }, "invalid"),
    ).toEqual({ kind: "error", code: "MP_CONNECT_EXCHANGE_FAILED", fallbackMessage: LINK_CANCELLED_MESSAGE });
  });

  it("navegador cerrado + status linked → vinculada (dismiss falso de Android)", () => {
    expect(resolveLinkOutcome({ kind: "closed" }, "linked")).toEqual({ kind: "linked" });
  });

  it("navegador cerrado + no linked → el mensaje de cancelación del mockup (AC4)", () => {
    expect(resolveLinkOutcome({ kind: "closed" }, "unlinked")).toEqual({
      kind: "error",
      code: null,
      fallbackMessage: LINK_CANCELLED_MESSAGE,
    });
  });
});

describe("runMpConnectLink (MOVO-112)", () => {
  it("abre la URL del backend y vuelve a consultar el status al cerrar", async () => {
    const calls: string[] = [];
    const outcome = await runMpConnectLink({
      getAuthorizationUrl: async () => {
        calls.push("url");
        return "https://auth.mercadopago.com/authorization?x=1";
      },
      openAuthSession: async (url) => {
        calls.push(`open:${url}`);
        return success("movo://mp-connect?result=success");
      },
      onBrowserClosed: () => calls.push("closed"),
      refetchStatus: async () => {
        calls.push("refetch");
        return "linked";
      },
    });

    expect(outcome).toEqual({ kind: "linked" });
    expect(calls).toEqual([
      "url",
      "open:https://auth.mercadopago.com/authorization?x=1",
      "closed",
      "refetch",
    ]);
  });

  it("consulta el status aunque el usuario haya cancelado", async () => {
    const refetchStatus = jest.fn().mockResolvedValue("invalid");
    const outcome = await runMpConnectLink({
      getAuthorizationUrl: async () => "https://x",
      openAuthSession: async () => closed("cancel"),
      refetchStatus,
    });

    expect(refetchStatus).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ kind: "error", code: null, fallbackMessage: LINK_CANCELLED_MESSAGE });
  });

  it("si falla pedir la URL, no abre el navegador y tira el error", async () => {
    const openAuthSession = jest.fn();
    await expect(
      runMpConnectLink({
        getAuthorizationUrl: async () => {
          throw new Error("503");
        },
        openAuthSession,
        refetchStatus: jest.fn(),
      }),
    ).rejects.toThrow("503");
    expect(openAuthSession).not.toHaveBeenCalled();
  });
});

describe("formatMpConnectedAt", () => {
  it("formatea día y mes corto sin año si es el año actual", () => {
    expect(formatMpConnectedAt("2026-09-12T15:00:00", new Date("2026-10-08T12:00:00"))).toBe("12 sep");
  });

  it("agrega el año si no es el actual", () => {
    expect(formatMpConnectedAt("2025-01-03T15:00:00", new Date("2026-10-08T12:00:00"))).toBe("3 ene 2025");
  });

  it("devuelve vacío ante una fecha inválida", () => {
    expect(formatMpConnectedAt("no-es-fecha")).toBe("");
  });
});
