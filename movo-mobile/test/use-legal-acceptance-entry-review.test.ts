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

/** Ver el comentario de `use-legal-acceptance-entry-dismiss.test.ts` — mismo motivo
 * para vivir en su propio archivo. */
describe("useLegalAcceptanceEntry — onReview", () => {
  it("navega a Perfil > Legal y cierra el sheet", async () => {
    const { result, rerender } = await renderHook(() => useLegalAcceptanceEntry());
    expect(result.current.visible).toBe(true);

    await act(async () => result.current.onReview());
    rerender(undefined);

    expect(router.push).toHaveBeenCalledWith("/profile/legal");
    expect(result.current.visible).toBe(false);
  });
});
