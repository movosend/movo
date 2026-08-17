import { fireEvent, render } from "@testing-library/react-native";
import { Platform } from "react-native";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { TimeWindowPicker } from "../components/send/time-window-picker";

jest.mock("@react-native-community/datetimepicker", () => {
  const { Pressable } = require("react-native");
  const MockDateTimePicker = (props: {
    testID?: string;
    onChange: (event: { type: string }, date?: Date) => void;
  }) => (
    <Pressable
      testID={props.testID}
      onPress={() => props.onChange({ type: "set" }, new Date(2026, 7, 20))}
    />
  );
  return {
    __esModule: true,
    default: MockDateTimePicker,
    DateTimePickerAndroid: { open: jest.fn() },
  };
});

const mockAndroidOpen = DateTimePickerAndroid.open as jest.Mock;

// MOVO-83 feedback: el campo de fecha era un `TextInput` de texto libre ("AAAA-MM-DD")
// en vez de un selector de fecha nativo — sin cobertura previa de este componente.
describe("TimeWindowPicker", () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, "OS", {
      value: originalOS,
      configurable: true,
    });
    mockAndroidOpen.mockClear();
  });

  it("en iOS muestra el placeholder y actualiza la fecha al elegir una", async () => {
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    const onChangeDate = jest.fn();

    const { getByTestId, getByText } = await render(
      <TimeWindowPicker
        testID="time-window"
        pickupDate=""
        timeWindowStart=""
        timeWindowEnd=""
        onChangeDate={onChangeDate}
        onChangeWindow={jest.fn()}
      />,
    );

    expect(getByText("Elegí una fecha")).toBeTruthy();

    fireEvent.press(getByTestId("time-window-date"));

    expect(onChangeDate).toHaveBeenCalledWith("2026-08-20");
  });

  it("en Android abre el diálogo nativo con la fecha mínima de hoy", async () => {
    Object.defineProperty(Platform, "OS", {
      value: "android",
      configurable: true,
    });
    const onChangeDate = jest.fn();

    const { getByTestId } = await render(
      <TimeWindowPicker
        testID="time-window"
        pickupDate="2026-08-20"
        timeWindowStart=""
        timeWindowEnd=""
        onChangeDate={onChangeDate}
        onChangeWindow={jest.fn()}
      />,
    );

    fireEvent.press(getByTestId("time-window-date"));

    expect(mockAndroidOpen).toHaveBeenCalledTimes(1);
    const options = mockAndroidOpen.mock.calls[0][0];
    expect(options.mode).toBe("date");
    expect(options.value).toEqual(new Date(2026, 7, 20));

    options.onChange({ type: "set" }, new Date(2026, 7, 21));
    expect(onChangeDate).toHaveBeenCalledWith("2026-08-21");
  });

  it("elegir una franja horaria la marca como seleccionada", async () => {
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    const onChangeWindow = jest.fn();

    const { getByTestId } = await render(
      <TimeWindowPicker
        testID="time-window"
        pickupDate=""
        timeWindowStart=""
        timeWindowEnd=""
        onChangeDate={jest.fn()}
        onChangeWindow={onChangeWindow}
      />,
    );

    fireEvent.press(getByTestId("time-window-window-09:00"));

    expect(onChangeWindow).toHaveBeenCalledWith("09:00", "12:00");
  });
});
