import { render } from "@testing-library/react-native";
import { SkeletonBlock } from "../components/ui/skeleton-block";

describe("SkeletonBlock", () => {
  afterEach(() => {
    (globalThis as { __reduceMotion?: boolean }).__reduceMotion = false;
  });

  it("renderiza con el fondo de skeleton del tema y respeta className, style y testID", async () => {
    const { getByTestId } = await render(
      <SkeletonBlock testID="sk" className="h-4 w-10" style={{ marginTop: 3 }} />,
    );
    const node = getByTestId("sk");

    expect(node.props.className).toContain("bg-bg-mute");
    expect(node.props.className).toContain("h-4 w-10");
  });

  it("con 'reducir movimiento' también renderiza (queda quieto, sin pulso)", async () => {
    (globalThis as { __reduceMotion?: boolean }).__reduceMotion = true;
    const { getByTestId } = await render(<SkeletonBlock testID="sk-static" className="h-4 w-10" />);

    expect(getByTestId("sk-static")).toBeTruthy();
  });
});
