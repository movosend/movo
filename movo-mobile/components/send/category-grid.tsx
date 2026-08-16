import { FileText, Package, ShieldAlert, type LucideIcon } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import type { PackageType } from "../../src/store/shipment-wizard-store";

interface CategoryOption {
  id: PackageType;
  label: string;
  sub: string;
  icon: LucideIcon;
}

/** Solo las 3 categorías reales del backend (`PackageType` en
 * `movo-svc-shipments/prisma/schema.prisma`) — el AC3 original pedía 5, decisión
 * tomada con el usuario de no extender el enum del backend en esta US (documentado en
 * CLAUDE.md al cerrar). */
const CATEGORIES: CategoryOption[] = [
  { id: "letter_document", label: "Documento", sub: "Sobres, cartas, docs", icon: FileText },
  { id: "standard_package", label: "Estándar", sub: "Caja o bolsa", icon: Package },
  { id: "fragile_item", label: "Frágil", sub: "Cuidado extra", icon: ShieldAlert },
];

// Etiquetas largas/descriptivas para contextos donde no hay riesgo de truncado
// (p.ej. el resumen final) — separadas de `CATEGORIES.label`, que se muestra
// dentro del botón de 2 columnas y necesita texto corto para no truncarse.
const FULL_LABELS: Record<PackageType, string> = {
  letter_document: "Carta o documento",
  standard_package: "Encomienda estándar",
  fragile_item: "Objeto frágil",
};

export function packageTypeLabel(packageType: PackageType | null): string {
  return packageType ? FULL_LABELS[packageType] : "—";
}

interface CategoryGridProps {
  value: PackageType | null;
  onChange: (value: PackageType) => void;
  testID?: string;
}

export function CategoryGrid({ value, onChange, testID }: CategoryGridProps) {
  return (
    <View testID={testID} className="flex-row flex-wrap gap-2">
      {CATEGORIES.map((cat) => {
        const selected = value === cat.id;
        const Icon = cat.icon;
        return (
          <Pressable
            key={cat.id}
            testID={testID ? `${testID}-${cat.id}` : undefined}
            onPress={() => onChange(cat.id)}
            className={`min-w-[47%] flex-1 flex-row items-center gap-2.5 rounded-[10px] border px-3.5 py-3 ${
              selected ? "border-fg bg-fg" : "border-border-strong bg-bg"
            }`}
          >
            <View
              className={`h-8 w-8 items-center justify-center rounded-lg ${selected ? "bg-white/10" : "bg-bg-mute"}`}
            >
              <Icon size={16} color={selected ? "#C6F24A" : "#5A5A62"} strokeWidth={1.8} />
            </View>
            <View className="flex-1">
              <Text
                className={`font-sans-semibold text-[13px] ${selected ? "text-white dark:text-ink-950" : "text-fg"}`}
                numberOfLines={1}
              >
                {cat.label}
              </Text>
              <Text
                className={`mt-0.5 font-sans text-[11px] ${
                  selected ? "text-white/60 dark:text-ink-950/50" : "text-fg-3"
                }`}
                numberOfLines={1}
              >
                {cat.sub}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
