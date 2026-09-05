import { render } from "@testing-library/react-native";
import { UsageStatsGrid } from "../components/profile/usage-stats-grid";

describe("UsageStatsGrid", () => {
  it("no renderiza nada si usageStats no vino (MOVO-170, todavía sin backend)", async () => {
    const { toJSON } = await render(<UsageStatsGrid usageStats={undefined} role="carrier" />);
    expect(toJSON()).toBeNull();
  });

  it("muestra 'Entregas' para el rol transportista", async () => {
    const { getByText } = await render(
      <UsageStatsGrid
        usageStats={{ delivered: 12, cancelled: 1, avgPackageWeightKg: 3.2 }}
        role="carrier"
      />
    );

    expect(getByText("Entregas")).toBeTruthy();
    expect(getByText("12")).toBeTruthy();
    expect(getByText("1 cancelado")).toBeTruthy();
    expect(getByText("3.2 kg")).toBeTruthy();
  });

  it("muestra 'Envíos hechos' para el rol emisor, sin cancelaciones", async () => {
    const { getByText } = await render(
      <UsageStatsGrid
        usageStats={{ delivered: 5, cancelled: 0, avgPackageWeightKg: null }}
        role="sender"
      />
    );

    expect(getByText("Envíos hechos")).toBeTruthy();
    expect(getByText("Sin cancelaciones")).toBeTruthy();
    expect(getByText("Sin datos")).toBeTruthy();
  });
});
