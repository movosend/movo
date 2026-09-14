import { act, renderHook } from "@testing-library/react-native";
import { router } from "expo-router";
import { useLegalAcceptanceEntry } from "../src/hooks/use-legal-acceptance-entry";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (s: { status: string }) => unknown) => selector({ status: "authenticated" }),
}));

jest.mock("../src/hooks/use-profile", () => ({
  useMyProfile: () => ({
    data: {
      termsAcceptedAt: null,
      termsVersion: null,
      privacyAcceptedAt: "2026-01-01T12:00:00.000Z",
      privacyVersion: require("@movo/shared/dist/config/legal").LEGAL_DOCUMENT_VERSIONS.privacy,
    },
  }),
}));

/**
 * Separado de `use-legal-acceptance-entry.test.ts`: un `act(async () => ...)` que
 * dispara `setState` dentro de este hook deja el entorno de act en un estado que
 * rompe el `renderHook` de CUALQUIER test que corra después en el mismo módulo
 * (reproducido, no depende de cuál acción se llame ni del orden) — este archivo
 * existe solo para que no quede ningún test corriendo después de esta mutación.
 */
describe("useLegalAcceptanceEntry — onDismiss", () => {
  it("cierra el sheet sin navegar", async () => {
    const { result, rerender } = await renderHook(() => useLegalAcceptanceEntry());
    expect(result.current.visible).toBe(true);

    await act(async () => result.current.onDismiss());
    rerender(undefined);

    expect(router.push).not.toHaveBeenCalled();
    expect(result.current.visible).toBe(false);
  });
});
