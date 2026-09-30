import { fireEvent, render } from "@testing-library/react-native";
import { Text } from "react-native";
import { RemoteImage } from "../components/ui/remote-image";
import { remoteImageSource, stableImageCacheKey } from "../src/lib/remote-image";

const SIGNED_A =
  "https://movo.s3.us-east-1.amazonaws.com/shipments/s1/creation/p1.jpg?X-Amz-Signature=aaa&X-Amz-Expires=300";
const SIGNED_B =
  "https://movo.s3.us-east-1.amazonaws.com/shipments/s1/creation/p1.jpg?X-Amz-Signature=bbb&X-Amz-Expires=300";

describe("stableImageCacheKey", () => {
  it("descarta la firma: la misma foto re-firmada comparte clave", () => {
    expect(stableImageCacheKey(SIGNED_A)).toBe(stableImageCacheKey(SIGNED_B));
    expect(stableImageCacheKey(SIGNED_A)).toBe(
      "https://movo.s3.us-east-1.amazonaws.com/shipments/s1/creation/p1.jpg",
    );
  });

  it("deja igual una URL pública sin query", () => {
    const url = "https://movo.s3.amazonaws.com/profile-photos/u1.jpg";
    expect(stableImageCacheKey(url)).toBe(url);
    expect(remoteImageSource(url)).toEqual({ uri: url, cacheKey: url });
  });
});

describe("RemoteImage", () => {
  const style = { width: 56, height: 56 };

  it("muestra el skeleton hasta que la imagen carga", async () => {
    const { getByTestId, queryByTestId } = await render(<RemoteImage testID="img" uri={SIGNED_A} style={style} />);

    expect(getByTestId("img-loading")).toBeTruthy();
    await fireEvent(getByTestId("img-image"), "load");
    expect(queryByTestId("img-loading")).toBeNull();
  });

  it("carga con caché en memoria y disco, por la clave estable", async () => {
    const { getByTestId } = await render(<RemoteImage testID="img" uri={SIGNED_A} style={style} />);

    const image = getByTestId("img-image");
    expect(image.props.cachePolicy).toBe("memory-disk");
    expect(image.props.source).toEqual({ uri: SIGNED_A, cacheKey: stableImageCacheKey(SIGNED_A) });
  });

  it("no vuelve al skeleton si solo cambia la firma de la misma foto", async () => {
    const { getByTestId, queryByTestId, rerender } = await render(
      <RemoteImage testID="img" uri={SIGNED_A} style={style} />,
    );
    await fireEvent(getByTestId("img-image"), "load");

    await rerender(<RemoteImage testID="img" uri={SIGNED_B} style={style} />);
    expect(queryByTestId("img-loading")).toBeNull();
  });

  it("vuelve al skeleton cuando cambia la foto", async () => {
    const { getByTestId, rerender } = await render(<RemoteImage testID="img" uri={SIGNED_A} style={style} />);
    await fireEvent(getByTestId("img-image"), "load");

    await rerender(
      <RemoteImage testID="img" uri="https://movo.s3.amazonaws.com/shipments/s1/creation/p2.jpg" style={style} />,
    );
    expect(getByTestId("img-loading")).toBeTruthy();
  });

  it("muestra el fallback si la imagen falla", async () => {
    const { getByTestId, getByText, queryByTestId } = await render(
      <RemoteImage testID="img" uri={SIGNED_A} style={style} fallback={<Text>TO</Text>} />,
    );

    await fireEvent(getByTestId("img-image"), "error");
    expect(queryByTestId("img-loading")).toBeNull();
    expect(getByTestId("img-error")).toBeTruthy();
    expect(getByText("TO")).toBeTruthy();
  });

  it("usa spinner en vez de skeleton cuando se pide", async () => {
    const { getByTestId } = await render(
      <RemoteImage testID="img" uri={SIGNED_A} style={style} loadingIndicator="spinner" />,
    );
    expect(getByTestId("img-loading")).toBeTruthy();
  });
});
