import { Linking, Platform } from "react-native";
import { buildNavigationCandidates, openNavigation } from "../src/lib/navigation-deeplink";

const target = { lat: -31.425, lng: -64.187 };
const WAZE = "waze://?ll=-31.425,-64.187&navigate=yes";
const WEB = "https://www.google.com/maps/dir/?api=1&destination=-31.425,-64.187&travelmode=driving";

describe("navigation-deeplink (MOVO-237)", () => {
  const originalOS = Platform.OS;

  // jest-expo ya trae `Linking.openURL` como mock global: `restoreAllMocks` no lo
  // repone, así que llamadas e implementaciones se arrastrarían entre tests.
  beforeEach(() => {
    jest.spyOn(Linking, "openURL").mockReset();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    Object.defineProperty(Platform, "OS", { value: originalOS, configurable: true });
  });

  function setPlatform(os: "ios" | "android") {
    Object.defineProperty(Platform, "OS", { value: os, configurable: true });
  }

  describe("buildNavigationCandidates", () => {
    it("Android: Google Maps nativo (google.navigation) → Waze → web", () => {
      expect(buildNavigationCandidates(target, "android")).toEqual([
        "google.navigation:q=-31.425,-64.187",
        WAZE,
        WEB,
      ]);
    });

    it("iOS: Google Maps nativo (comgooglemaps) → Waze → web", () => {
      expect(buildNavigationCandidates(target, "ios")).toEqual([
        "comgooglemaps://?daddr=-31.425,-64.187&directionsmode=driving",
        WAZE,
        WEB,
      ]);
    });
  });

  describe("openNavigation", () => {
    it("con Google Maps instalado abre directo su deep-link nativo", async () => {
      setPlatform("android");
      const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);

      await expect(openNavigation(target)).resolves.toBe("google.navigation:q=-31.425,-64.187");
      expect(openURL).toHaveBeenCalledTimes(1);
    });

    it("sin Google Maps pero con Waze, cae a Waze", async () => {
      setPlatform("ios");
      const openURL = jest
        .spyOn(Linking, "openURL")
        .mockRejectedValueOnce(new Error("no app"))
        .mockResolvedValue(true);

      await expect(openNavigation(target)).resolves.toBe(WAZE);
      expect(openURL).toHaveBeenCalledTimes(2);
    });

    it("sin ninguna app instalada, cae a la URL web de Google Maps", async () => {
      setPlatform("android");
      jest
        .spyOn(Linking, "openURL")
        .mockRejectedValueOnce(new Error("no app"))
        .mockRejectedValueOnce(new Error("no app"))
        .mockResolvedValue(true);

      await expect(openNavigation(target)).resolves.toBe(WEB);
    });

    it("devuelve null si ni el browser acepta la URL", async () => {
      setPlatform("ios");
      jest.spyOn(Linking, "openURL").mockRejectedValue(new Error("no handler"));

      await expect(openNavigation(target)).resolves.toBeNull();
    });

    it("con coordenadas inválidas no abre nada y devuelve null", async () => {
      setPlatform("ios");
      const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);

      await expect(openNavigation({ lat: NaN, lng: -64.187 })).resolves.toBeNull();
      expect(openURL).not.toHaveBeenCalled();
    });
  });
});
