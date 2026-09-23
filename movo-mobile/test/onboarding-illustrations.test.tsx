import { render } from "@testing-library/react-native";
import {
  CameraIllustration,
  LocationIllustration,
  NetworkIllustration,
  NotificationsIllustration,
  ReadyIllustration,
  TrustIllustration,
} from "../components/onboarding/onboarding-illustrations";

/**
 * Smoke test (MOVO-249): cada ilustración es una reconstrucción fiel del prototipo
 * (SVG + Reanimated + fotos reales) — acá solo se verifica que monta sin explotar
 * (paths SVG válidos, hooks de Reanimated bien encadenados, sin dividir por cero en
 * la geometría del globo/discos). La fidelidad visual en sí no es verificable en este
 * entorno (se prueba en device).
 */
describe("onboarding-illustrations (MOVO-249)", () => {
  it("NetworkIllustration monta sin errores", async () => {
    await expect(render(<NetworkIllustration />)).resolves.toBeTruthy();
  });

  it("TrustIllustration monta sin errores", async () => {
    await expect(render(<TrustIllustration />)).resolves.toBeTruthy();
  });

  it("LocationIllustration (globo) monta sin errores", async () => {
    await expect(render(<LocationIllustration />)).resolves.toBeTruthy();
  });

  it("NotificationsIllustration monta sin errores", async () => {
    await expect(render(<NotificationsIllustration />)).resolves.toBeTruthy();
  });

  it("CameraIllustration monta sin errores", async () => {
    await expect(render(<CameraIllustration />)).resolves.toBeTruthy();
  });

  it("ReadyIllustration monta sin errores", async () => {
    await expect(render(<ReadyIllustration />)).resolves.toBeTruthy();
  });
});
