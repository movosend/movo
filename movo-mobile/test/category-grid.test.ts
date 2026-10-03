import { FileText, Package, ShieldAlert } from "lucide-react-native";
import { packageTypeIcon } from "../components/send/category-grid";

describe("packageTypeIcon (MOVO-271 AC6)", () => {
  it("devuelve el mismo ícono que el wizard muestra para cada tipo", () => {
    expect(packageTypeIcon("letter_document")).toBe(FileText);
    expect(packageTypeIcon("standard_package")).toBe(Package);
    expect(packageTypeIcon("fragile_item")).toBe(ShieldAlert);
  });

  it("sin tipo cae a la caja genérica", () => {
    expect(packageTypeIcon(null)).toBe(Package);
  });
});
