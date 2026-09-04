import { fireEvent, render } from "@testing-library/react-native";
import { Platform } from "react-native";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { DepartureDateTimePicker } from "../components/trips/departure-date-time-picker";

jest.mock("@react-native-community/datetimepicker", () => {
  const { Pressable } = require("react-native");
  const MockDateTimePicker = (props: {
    testID?: string;
    mode: string;
    onChange: (event: { type: string }, date?: Date) => void;
  }) => (
    <Pressable
      testID={props.testID}
      onPress={() =>
        props.onChange(
          { type: "set" },
          props.mode === "date" ? new Date(2026, 8, 20, 0, 0) : new Date(1970, 0, 1, 15, 30),
        )
      }
    />
  );
  return {
    __esModule: true,
    default: MockDateTimePicker,
    DateTimePickerAndroid: { open: jest.fn() },
  };
});

const mockAndroidOpen = DateTimePickerAndroid.open as jest.Mock;

// Instante base: 10 de sep 2026, 09:00 — usado para verificar que cambiar la fecha
// conserva la hora ya elegida, y viceversa (combineDateAndTime).
const BASE_VALUE = new Date(2026, 8, 10, 9, 0);

describe("DepartureDateTimePicker", () => {
  const originalOS = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, "OS", { value: originalOS, configurable: true });
    mockAndroidOpen.mockClear();
  });

  it("en iOS, cambiar la fecha conserva la hora ya elegida", async () => {
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    const onChange = jest.fn();

    const { getByTestId } = await render(
      <DepartureDateTimePicker testID="departure" value={BASE_VALUE} onChange={onChange} />,
    );

    fireEvent.press(getByTestId("departure-date"));

    const result = onChange.mock.calls[0][0] as Date;
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(8);
    expect(result.getDate()).toBe(20);
    // Hora conservada de BASE_VALUE (09:00), no la del mock de fecha (00:00).
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(0);
  });

  it("en iOS, cambiar la hora conserva la fecha ya elegida", async () => {
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    const onChange = jest.fn();

    const { getByTestId } = await render(
      <DepartureDateTimePicker testID="departure" value={BASE_VALUE} onChange={onChange} />,
    );

    fireEvent.press(getByTestId("departure-time"));

    const result = onChange.mock.calls[0][0] as Date;
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(8);
    expect(result.getDate()).toBe(10);
    expect(result.getHours()).toBe(15);
    expect(result.getMinutes()).toBe(30);
  });

  it("en Android abre el diálogo nativo de fecha con la fecha mínima de hoy", async () => {
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    const onChange = jest.fn();

    const { getByTestId } = await render(
      <DepartureDateTimePicker testID="departure" value={BASE_VALUE} onChange={onChange} />,
    );

    fireEvent.press(getByTestId("departure-date"));

    expect(mockAndroidOpen).toHaveBeenCalledTimes(1);
    const options = mockAndroidOpen.mock.calls[0][0];
    expect(options.mode).toBe("date");
    expect(options.value).toEqual(BASE_VALUE);
    expect(options.minimumDate).toBeInstanceOf(Date);

    options.onChange({ type: "set" }, new Date(2026, 8, 21));
    const result = onChange.mock.calls[0][0] as Date;
    expect(result.getDate()).toBe(21);
    expect(result.getHours()).toBe(9);
  });

  it("en Android abre el diálogo nativo de hora", async () => {
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    const onChange = jest.fn();

    const { getByTestId } = await render(
      <DepartureDateTimePicker testID="departure" value={BASE_VALUE} onChange={onChange} />,
    );

    fireEvent.press(getByTestId("departure-time"));

    expect(mockAndroidOpen).toHaveBeenCalledTimes(1);
    const options = mockAndroidOpen.mock.calls[0][0];
    expect(options.mode).toBe("time");

    options.onChange({ type: "set" }, new Date(1970, 0, 1, 18, 45));
    const result = onChange.mock.calls[0][0] as Date;
    expect(result.getHours()).toBe(18);
    expect(result.getMinutes()).toBe(45);
    expect(result.getDate()).toBe(10);
  });
});
