import { fireEvent, render } from "@testing-library/react-native";
import { NotificationCategoryRow } from "../components/notifications/notification-category-row";

describe("NotificationCategoryRow", () => {
  it("navega al detalle al tocar la fila", async () => {
    const onPress = jest.fn();
    const { getByTestId } = await render(
      <NotificationCategoryRow
        testID="row"
        title="Custodia del paquete"
        sub="Retiro y entrega confirmados"
        implemented
        enabled
        dimmed={false}
        permissionBlocked={false}
        onToggle={jest.fn()}
        onPress={onPress}
      />,
    );

    await fireEvent.press(getByTestId("row-open"));

    expect(onPress).toHaveBeenCalled();
  });

  it("categoría implementada: el toggle dispara onToggle", async () => {
    const onToggle = jest.fn();
    const { getByTestId } = await render(
      <NotificationCategoryRow
        testID="row"
        title="Custodia del paquete"
        sub="Retiro y entrega confirmados"
        implemented
        enabled
        dimmed={false}
        permissionBlocked={false}
        onToggle={onToggle}
        onPress={jest.fn()}
      />,
    );

    await fireEvent.press(getByTestId("row-toggle"));

    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it("categoría 'Pronto': muestra la pill y el toggle no dispara onToggle", async () => {
    const onToggle = jest.fn();
    const { getByTestId } = await render(
      <NotificationCategoryRow
        testID="row"
        title="Verificaciones"
        sub="Resultado de identidad"
        implemented={false}
        enabled={false}
        dimmed={false}
        permissionBlocked={false}
        onToggle={onToggle}
        onPress={jest.fn()}
      />,
    );

    expect(getByTestId("row-pending")).toBeTruthy();
    await fireEvent.press(getByTestId("row-toggle"));

    expect(onToggle).not.toHaveBeenCalled();
  });

  it("permiso del SO bloqueado: el toggle de una categoría implementada tampoco dispara onToggle", async () => {
    const onToggle = jest.fn();
    const { getByTestId } = await render(
      <NotificationCategoryRow
        testID="row"
        title="Custodia del paquete"
        sub="Retiro y entrega confirmados"
        implemented
        enabled
        dimmed={false}
        permissionBlocked
        onToggle={onToggle}
        onPress={jest.fn()}
      />,
    );

    await fireEvent.press(getByTestId("row-toggle"));

    expect(onToggle).not.toHaveBeenCalled();
  });
});
