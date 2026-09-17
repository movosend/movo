import { renderHook } from "@testing-library/react-native";
import { LEGAL_DOCUMENT_VERSIONS } from "@movo/shared/dist/config/legal";
import { useLegalAcceptanceEntry } from "../src/hooks/use-legal-acceptance-entry";

jest.mock("expo-router", () => ({
  router: { push: jest.fn() },
}));

let mockAuthStatus: "authenticated" | "unauthenticated" = "authenticated";
jest.mock("../src/store/auth-store", () => ({
  useAuthStore: (selector: (s: { status: string }) => unknown) => selector({ status: mockAuthStatus }),
}));

let mockProfile: unknown;
jest.mock("../src/hooks/use-profile", () => ({
  useMyProfile: () => ({ data: mockProfile }),
}));

const CURRENT_PROFILE = {
  termsAcceptedAt: "2026-01-01T12:00:00.000Z",
  termsVersion: LEGAL_DOCUMENT_VERSIONS.terms,
  privacyAcceptedAt: "2026-01-01T12:00:00.000Z",
  privacyVersion: LEGAL_DOCUMENT_VERSIONS.privacy,
};

/**
 * MOVO-229: reemplaza el `Alert.alert` de la primera pasada por un estado
 * derivado (`visible`) que controla el sheet custom `LegalEntrySheet` — sigue
 * siendo no bloqueante (decisión ya confirmada): "Ahora no" solo cierra el sheet.
 */
describe("useLegalAcceptanceEntry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthStatus = "authenticated";
    mockProfile = CURRENT_PROFILE;
  });

  it("no muestra nada si ambos documentos están al día", async () => {
    const { result, unmount } = await renderHook(() => useLegalAcceptanceEntry());

    expect(result.current.visible).toBe(false);
    unmount();
  });

  it("visible=true con copy de onboarding si nunca se aceptó nada", async () => {
    mockProfile = { ...CURRENT_PROFILE, termsAcceptedAt: null, termsVersion: null };

    const { result, unmount } = await renderHook(() => useLegalAcceptanceEntry());

    expect(result.current.visible).toBe(true);
    expect(result.current.copy.title).toBe("Antes de empezar");
    unmount();
  });

  it("no muestra nada mientras el perfil no cargó (evita el parpadeo)", async () => {
    mockProfile = undefined;

    const { result, unmount } = await renderHook(() => useLegalAcceptanceEntry());

    expect(result.current.visible).toBe(false);
    unmount();
  });

  it("no muestra nada sin sesión autenticada", async () => {
    mockAuthStatus = "unauthenticated";
    mockProfile = { termsAcceptedAt: null, termsVersion: null, privacyAcceptedAt: null, privacyVersion: null };

    const { result, unmount } = await renderHook(() => useLegalAcceptanceEntry());

    expect(result.current.visible).toBe(false);
    unmount();
  });


  // `onDismiss`/`onReview` (mutan estado vía `act(async () => ...)`) viven en sus
  // propios archivos (`use-legal-acceptance-entry-dismiss.test.ts`/`-review.test.ts`)
  // — cada uno deja el entorno de act en un estado que rompe el `renderHook` de
  // CUALQUIER test que corra después en el mismo módulo, sin importar el orden.
});
