import { render } from "@testing-library/react-native";
import {
  AvatarPeekViewer,
  computePeekGeometry,
} from "../components/profile/avatar-peek-viewer";

const BOUNDS = { width: 390, height: 844, insetTop: 47, insetBottom: 34 };

describe("computePeekGeometry (peek circular, siempre centrado en pantalla)", () => {
  it("centra el peek en el medio de la pantalla (horizontal y vertical, dentro del área segura), sin importar dónde está el avatar", () => {
    const rect = { x: 24, y: 60, width: 88, height: 88 }; // avatar pegado al header
    const geometry = computePeekGeometry(rect, BOUNDS);

    const finalCenterX = geometry.left + geometry.size / 2;
    const finalCenterY = geometry.top + geometry.size / 2;
    expect(finalCenterX).toBeCloseTo(BOUNDS.width / 2);
    expect(finalCenterY).toBeCloseTo(
      BOUNDS.insetTop + (BOUNDS.height - BOUNDS.insetBottom - BOUNDS.insetTop) / 2,
    );
  });

  it("el offset de origen apunta desde el centro de pantalla hacia la posición real del avatar", () => {
    const rect = { x: 24, y: 60, width: 88, height: 88 }; // arriba a la izquierda del centro
    const geometry = computePeekGeometry(rect, BOUNDS);

    expect(geometry.originOffsetX).toBeLessThan(0);
    expect(geometry.originOffsetY).toBeLessThan(0);
  });

  it("un avatar ya centrado en pantalla arranca la animación sin ningún offset de origen", () => {
    // Centro de pantalla exacto para `BOUNDS`: x=195, y=47+(844-34-47)/2=428.5.
    const rect = { x: 155, y: 388.5, width: 80, height: 80 };
    const geometry = computePeekGeometry(rect, BOUNDS);

    expect(geometry.originOffsetX).toBeCloseTo(0);
    expect(geometry.originOffsetY).toBeCloseTo(0);
  });

  it("el tamaño del peek se capa contra el ancho de pantalla, dejando margen a los lados", () => {
    const narrowBounds = { width: 320, height: 700, insetTop: 47, insetBottom: 34 };
    const geometry = computePeekGeometry({ x: 100, y: 300, width: 56, height: 56 }, narrowBounds);

    expect(geometry.size).toBeLessThanOrEqual(narrowBounds.width - 48);
  });

  it("en una pantalla ancha, el peek usa su tamaño máximo (320) sin estirarse al ancho completo", () => {
    const wideBounds = { width: 500, height: 900, insetTop: 47, insetBottom: 34 };
    const geometry = computePeekGeometry({ x: 100, y: 300, width: 56, height: 56 }, wideBounds);

    expect(geometry.size).toBe(320);
  });

  it("originScale es proporcional al tamaño real del avatar contra el tamaño final del peek", () => {
    const small = computePeekGeometry({ x: 100, y: 300, width: 56, height: 56 }, BOUNDS);
    const big = computePeekGeometry({ x: 100, y: 300, width: 88, height: 88 }, BOUNDS);

    expect(small.originScale).toBeCloseTo(56 / small.size);
    expect(big.originScale).toBeCloseTo(88 / big.size);
    expect(big.originScale).toBeGreaterThan(small.originScale);
  });
});

/**
 * `measureInWindow` nunca dispara su callback en este entorno de test (jest-expo no
 * simula un layout pass nativo — mismo gap ya documentado para `sender-actions-bar.tsx`,
 * MOVO-29) así que el ciclo completo de abrir/cerrar el peek (que depende de esa
 * medición real) queda cubierto manualmente en device, no acá — estos tests solo
 * verifican el wiring: qué se monta, y que la geometría (arriba) es correcta.
 */
describe("AvatarPeekViewer", () => {
  it("sin photoUrl, renderiza el avatar de iniciales sin ningún botón interactivo", async () => {
    const { getByTestId, queryByTestId } = await render(
      <AvatarPeekViewer testID="avatar" fullName="Martina Zurita" photoUrl={null} />,
    );

    expect(getByTestId("avatar")).toBeTruthy();
    expect(queryByTestId("avatar-button")).toBeNull();
  });

  it("con photoUrl, envuelve el avatar en un botón de long-press con label accesible", async () => {
    const { getByTestId } = await render(
      <AvatarPeekViewer testID="avatar" fullName="Martina Zurita" photoUrl="https://movo.app/p.jpg" />,
    );

    const button = getByTestId("avatar-button");
    expect(button).toBeTruthy();
    expect(button.props.accessibilityLabel).toMatch(/mantener presionado/i);
    expect(getByTestId("avatar")).toBeTruthy();
  });
});
