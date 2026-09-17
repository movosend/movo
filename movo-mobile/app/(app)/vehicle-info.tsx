import { router } from "expo-router";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Search,
  Truck,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BrandAvatar } from "../../components/vehicle/brand-avatar";
import { PlateInput } from "../../components/vehicle/plate-input";
import { TierPicker } from "../../components/vehicle/tier-picker";
import { PrimaryButton } from "../../components/auth/primary-button";
import { ProfileSkeleton } from "../../components/profile/profile-skeleton";
import { ErrorBanner } from "../../components/ui/error-banner";
import { GridPattern } from "../../components/ui/grid-pattern";
import { SuccessBanner } from "../../components/ui/success-banner";
import { TextField } from "../../components/ui/text-field";
import {
  CARGO_TIERS,
  FITS_BY_TIER,
  VEHICLE_BRANDS,
  VEHICLE_CATALOG,
  normalizeSearchText,
  tierById,
} from "../../src/data/vehicle-catalog";
import {
  detectFormat,
  formatLabel,
  isPlateValid,
  maskPlateInput,
  plateFormatErrorMessage,
  type PlateFormat,
} from "../../src/lib/plate-format";
import { useMyVehicle, useUpsertVehicle } from "../../src/hooks/use-vehicle";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import type { VehicleProfile } from "@movo/shared/dist/types/user-profile";

type Step = "empty" | "brand" | "model" | "manual" | "plate" | "view" | "edit";

interface Draft {
  brand: string;
  model: string;
  segment: string;
  tierId: string;
}

const EMPTY_DRAFT: Draft = { brand: "", model: "", segment: "", tierId: "M" };

const TITLES: Record<Step, string> = {
  empty: "Ficha de vehículo",
  brand: "Elegí la marca",
  model: "Elegí el modelo",
  manual: "Cargar modelo nuevo",
  plate: "Patente y volumen",
  view: "Ficha de vehículo",
  edit: "Editar ficha",
};

/** Reconstruye el draft de edición a partir de lo persistido — `VehicleProfile` solo
 * guarda `cargoCapacityLabel` (texto), así que el tier/segmento se re-derivan
 * matcheando contra el catálogo cuando es posible (ficha creada con el selector) o
 * cayendo a un default razonable (ficha vieja de MOVO-172, texto libre). */
function draftFromVehicle(vehicle: VehicleProfile): Draft {
  const catalogModel = VEHICLE_CATALOG[vehicle.brand]?.find(
    (m) => m.name === vehicle.model,
  );
  const matchedTier = CARGO_TIERS.find(
    (t) => t.cap === vehicle.cargoCapacityLabel,
  );
  return {
    brand: vehicle.brand,
    model: vehicle.model,
    segment: catalogModel?.segment ?? "",
    tierId: matchedTier?.id ?? catalogModel?.tierId ?? "M",
  };
}

export default function VehicleInfoScreen() {
  const { data: vehicle, isLoading } = useMyVehicle();
  const upsertVehicle = useUpsertVehicle({
    onSuccess: () => setSuccessMessage("Guardamos tu vehículo."),
  });

  const [step, setStep] = useState<Step>("empty");
  const [initialized, setInitialized] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [query, setQuery] = useState("");
  const [plate, setPlate] = useState("");
  const [format, setFormat] = useState<PlateFormat>("mercosur");
  const [tiersOpen, setTiersOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Un solo seed desde el vehículo persistido, la primera vez que llega — pasos
  // posteriores manejan su propio estado sin que este efecto los pise.
  useEffect(() => {
    if (initialized || isLoading) return;
    if (vehicle) {
      setDraft(draftFromVehicle(vehicle));
      setPlate(vehicle.licensePlate);
      setFormat(detectFormat(vehicle.licensePlate, "mercosur"));
      setStep("view");
    } else {
      setStep("empty");
    }
    setInitialized(true);
  }, [vehicle, isLoading, initialized]);

  const hasCar = !!vehicle;

  function handleBack() {
    if (step === "view" || step === "empty") {
      if (router.canGoBack()) router.back();
      else router.replace("/profile/edit");
      return;
    }
    if (step === "edit") {
      setStep("view");
      return;
    }
    if (step === "plate") {
      setStep(hasCar ? "edit" : "model");
      return;
    }
    if (step === "brand") {
      setStep(hasCar ? "edit" : "empty");
      return;
    }
    if (step === "model" || step === "manual") {
      setStep("brand");
      return;
    }
  }

  function goBrand() {
    setQuery("");
    setStep("brand");
  }

  function pickBrand(brand: string) {
    setDraft((d) => ({ ...d, brand, model: "", segment: "" }));
    setQuery("");
    setStep("model");
  }

  function pickModel(model: string, segment: string, tierId: string) {
    setDraft((d) => ({ ...d, model, segment, tierId }));
    setTiersOpen(false);
    setStep("plate");
  }

  function goManual() {
    setDraft((d) => ({ ...d, model: "" }));
    setStep("manual");
  }

  function handlePlateChange(raw: string) {
    const { value, format: nextFormat } = maskPlateInput(raw, format);
    setPlate(value);
    setFormat(nextFormat);
  }

  async function handleSave() {
    setErrorMessage(null);
    try {
      await upsertVehicle.mutateAsync({
        brand: draft.brand.trim(),
        model: draft.model.trim(),
        cargoCapacityLabel: tierById(draft.tierId).cap,
        licensePlate: plate,
      });
      setStep("view");
    } catch (err) {
      setErrorMessage(
        friendlyErrorMessage(
          err,
          "No pudimos guardar tu vehículo. Intentá de nuevo.",
        ),
      );
    }
  }

  const plateValid = isPlateValid(plate, format);
  const canSave = plateValid && !!draft.model.trim();
  const saveLabel = hasCar ? "Guardar cambios" : "Guardar vehículo";

  if (isLoading || !initialized)
    return <ProfileSkeleton testID="vehicle-info-skeleton" />;

  return (
    <SafeAreaView className="flex-1 bg-white" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="vehicle-info-back"
          onPress={handleBack}
          className="h-[38px] w-[38px] items-center justify-center rounded-full bg-ink-100"
        >
          <ChevronLeft size={18} color="#0A0A0B" strokeWidth={2.2} />
        </Pressable>
        <Text className="font-sans-semibold text-[21px] tracking-[-0.02em] text-ink-950">
          {TITLES[step]}
        </Text>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 16 : 0}
      >
        <ScrollView
          testID="vehicle-info-content"
          className="flex-1 px-5"
          contentContainerClassName="pb-6"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <SuccessBanner
            testID="vehicle-info-success"
            message={successMessage}
            onDismiss={() => setSuccessMessage(null)}
          />
          <ErrorBanner testID="vehicle-info-error" message={errorMessage} />

          {step === "empty" ? <EmptyStep /> : null}

          {step === "brand" ? (
            <BrandStep
              query={query}
              onQueryChange={setQuery}
              onPick={pickBrand}
              onManual={goManual}
            />
          ) : null}

          {step === "model" ? (
            <ModelStep
              draft={draft}
              onChangeBrand={goBrand}
              onPick={pickModel}
              onManual={goManual}
            />
          ) : null}

          {step === "manual" ? (
            <ManualStep
              draft={draft}
              onChangeDraft={(patch) => setDraft((d) => ({ ...d, ...patch }))}
            />
          ) : null}

          {step === "plate" ? (
            <PlateStep
              draft={draft}
              plate={plate}
              format={format}
              tiersOpen={tiersOpen}
              onToggleTiers={() => setTiersOpen((v) => !v)}
              onChangePlate={handlePlateChange}
              onChangeFormat={(f) => {
                setFormat(f);
                setPlate("");
              }}
              onChangeTier={(tierId) => setDraft((d) => ({ ...d, tierId }))}
              onChangeBrand={goBrand}
            />
          ) : null}

          {step === "view" && vehicle ? (
            <ViewStep draft={draft} plate={plate} />
          ) : null}

          {step === "edit" ? (
            <EditStep
              draft={draft}
              plate={plate}
              onEditBrand={goBrand}
              onEditPlate={() => setStep("plate")}
            />
          ) : null}
        </ScrollView>

        <View className="border-t border-ink-950/[0.08] px-5 pb-8 pt-3.5">
          {step === "empty" ? (
            <PrimaryButton
              testID="vehicle-info-register"
              label="Registrar vehículo"
              onPress={goBrand}
            />
          ) : null}
          {step === "manual" ? (
            <PrimaryButton
              testID="vehicle-info-continue"
              label="Continuar"
              onPress={() => setStep("plate")}
              disabled={!draft.brand.trim() || !draft.model.trim()}
            />
          ) : null}
          {step === "plate" ? (
            <PrimaryButton
              testID="vehicle-info-submit"
              label={saveLabel}
              onPress={() => void handleSave()}
              disabled={!canSave}
              loading={upsertVehicle.isPending}
            />
          ) : null}
          {step === "view" ? (
            <Pressable
              testID="vehicle-info-edit"
              onPress={() => setStep("edit")}
              className="w-full items-center justify-center rounded-lg border-[1.5px] border-ink-950 py-3.5"
            >
              <Text className="font-sans-semibold text-[15.5px] text-ink-950">
                Editar ficha
              </Text>
            </Pressable>
          ) : null}
          {step === "brand" || step === "model" ? (
            <Text className="py-4 text-center font-sans text-[12.5px] text-ink-400">
              {step === "brand"
                ? "Elegí una marca para continuar"
                : "Elegí tu modelo: el volumen ya viene calculado"}
            </Text>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function EmptyStep() {
  return (
    <View className="pt-2">
      <View className="relative overflow-hidden rounded-[14px] border border-ink-950/[0.08] bg-ink-50 px-[22px] py-[26px]">
        <GridPattern color="#0A0A0B" opacity={0.05} />
        <View className="mb-[18px] h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-ink-950">
          <Truck size={26} strokeWidth={1.9} color="#C6F24A" />
        </View>
        <Text className="mb-2 font-sans-semibold text-[22px] tracking-[-0.02em] text-ink-950">
          Todavía no registraste tu vehículo
        </Text>
        <Text className="font-sans text-[14.5px] leading-[22px] text-ink-600">
          Elegís marca y modelo de una lista y nosotros calculamos cuánto podés
          llevar. Te toma menos de un minuto.
        </Text>
      </View>
      <View className="mt-6 gap-3.5">
        {[
          "Marca y modelo, de la lista de autos más comunes en Argentina.",
          "El volumen de carga sale del modelo. Podés ajustarlo.",
          "La patente, para que quien recibe verifique el auto.",
        ].map((text, i) => (
          <View key={text} className="flex-row items-start gap-3">
            <View className="mt-0.5 h-[26px] w-[26px] items-center justify-center rounded-full bg-ink-100">
              <Text className="font-mono-semibold text-[11px] text-ink-950">
                {i + 1}
              </Text>
            </View>
            <Text className="flex-1 font-sans text-[14px] leading-[21px] text-ink-600">
              {text}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function BrandStep({
  query,
  onQueryChange,
  onPick,
  onManual,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  onPick: (brand: string) => void;
  onManual: () => void;
}) {
  const q = normalizeSearchText(query);
  const brands = VEHICLE_BRANDS.filter(
    (b) => !q || normalizeSearchText(b).includes(q),
  );

  return (
    <View>
      <View className="relative mb-[18px] justify-center">
        <Search
          size={18}
          color="#8A8A93"
          strokeWidth={2}
          style={{ position: "absolute", left: 14, zIndex: 1 }}
        />
        <TextInput
          testID="vehicle-info-brand-search"
          placeholder="Buscar marca"
          placeholderTextColor="#8A8A93"
          value={query}
          onChangeText={onQueryChange}
          className="h-[46px] w-full rounded-md border-[1.5px] border-ink-950/[0.08] bg-ink-50 pl-[42px] pr-3.5 font-sans text-[16px] text-ink-950"
        />
      </View>
      <Text className="mb-3 font-sans-semibold text-[11px] uppercase tracking-wider text-ink-600">
        Marcas más comunes en Argentina
      </Text>
      <View className="flex-row flex-wrap gap-2.5">
        {brands.map((brand) => (
          <Pressable
            key={brand}
            testID={`vehicle-info-brand-${brand}`}
            onPress={() => onPick(brand)}
            className="flex-row items-center gap-[11px] rounded-lg border-[1.5px] border-ink-950/[0.08] bg-white px-3 py-3.5"
            style={{ width: "48%" }}
          >
            <BrandAvatar brand={brand} size={34} />
            <View className="min-w-0 flex-1 gap-0.5">
              <Text
                className="font-sans-medium text-[14px] text-ink-950"
                numberOfLines={1}
              >
                {brand}
              </Text>
              <Text className="font-sans text-[11px] text-ink-400">
                {VEHICLE_CATALOG[brand].length} modelos
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
      <Pressable
        testID="vehicle-info-brand-manual"
        onPress={onManual}
        className="mt-4 w-full items-center justify-center rounded-lg border-[1.5px] border-dashed border-ink-950/[0.18] bg-ink-50 py-[15px]"
      >
        <Text className="font-sans-medium text-[14px] text-ink-950">
          No encuentro mi marca
        </Text>
      </Pressable>
    </View>
  );
}

function ModelStep({
  draft,
  onChangeBrand,
  onPick,
  onManual,
}: {
  draft: Draft;
  onChangeBrand: () => void;
  onPick: (model: string, segment: string, tierId: string) => void;
  onManual: () => void;
}) {
  const models = VEHICLE_CATALOG[draft.brand] ?? [];

  return (
    <View>
      <View className="mb-[18px] flex-row items-center gap-[11px] rounded-lg bg-ink-50 px-3.5 py-3">
        <BrandAvatar brand={draft.brand} size={34} bgClassName="bg-white" />
        <Text className="font-sans-medium text-[15px] text-ink-950">
          {draft.brand}
        </Text>
        <Pressable
          testID="vehicle-info-model-change-brand"
          onPress={onChangeBrand}
          className="ml-auto"
        >
          <Text className="font-sans-medium text-[13px] text-[#6E8E1E] underline">
            Cambiar
          </Text>
        </Pressable>
      </View>
      <Text className="mb-3 font-sans-semibold text-[11px] uppercase tracking-wider text-ink-600">
        Modelo · volumen estándar
      </Text>
      <View className="gap-2">
        {models.map((model) => {
          const tier = tierById(model.tierId);
          return (
            <Pressable
              key={model.name}
              testID={`vehicle-info-model-${model.name}`}
              onPress={() => onPick(model.name, model.segment, model.tierId)}
              className="flex-row items-center gap-3 rounded-lg border-[1.5px] border-ink-950/[0.08] bg-white px-3.5 py-[13px]"
            >
              <View className="min-w-0 flex-1 gap-[3px]">
                <Text className="font-sans-medium text-[15px] text-ink-950">
                  {model.name}
                </Text>
                <Text className="font-sans text-[11.5px] text-ink-400">
                  {model.segment} · {tier.cap.replace("Hasta ", "hasta ")}
                </Text>
              </View>
              <View className="flex-row items-center gap-1.5">
                <View className="h-[26px] min-w-[26px] items-center justify-center rounded-md bg-ink-950 px-1">
                  <Text className="font-mono-semibold text-[11px] text-lime-500">
                    {model.tierId}
                  </Text>
                </View>
                <ChevronRight size={16} color="#B4B4BC" strokeWidth={2.2} />
              </View>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        testID="vehicle-info-model-manual"
        onPress={onManual}
        className="mt-4 w-full items-center justify-center rounded-lg border-[1.5px] border-dashed border-ink-950/[0.18] bg-ink-50 py-[15px]"
      >
        <Text className="font-sans-medium text-[14px] text-ink-950">
          Mi modelo no está en la lista
        </Text>
      </Pressable>
    </View>
  );
}

function ManualStep({
  draft,
  onChangeDraft,
}: {
  draft: Draft;
  onChangeDraft: (patch: Partial<Draft>) => void;
}) {
  return (
    <View>
      <View className="mb-[22px] flex-row gap-[11px] rounded-lg border-[1.5px] border-lime-200 bg-lime-200/30 p-3.5">
        <CheckCircle2 size={19} color="#6E8E1E" strokeWidth={2} />
        <Text className="flex-1 font-sans text-[13.5px] leading-[20px] text-ink-950">
          Ese modelo todavía no está en nuestra base. Cargalo a mano: lo
          verificamos en 24 h y después queda para todos.
        </Text>
      </View>
      <View className="gap-[18px]">
        <TextField
          testID="vehicle-info-manual-brand"
          label="Marca"
          placeholder="Ej. Chery"
          value={draft.brand}
          onChangeText={(brand) => onChangeDraft({ brand })}
          autoCapitalize="words"
          maxLength={40}
          containerClassName="gap-[7px]"
        />
        <TextField
          testID="vehicle-info-manual-model"
          label="Modelo"
          placeholder="Ej. Tiggo 2"
          value={draft.model}
          onChangeText={(model) =>
            onChangeDraft({ model, segment: "Cargado a mano" })
          }
          autoCapitalize="words"
          maxLength={40}
          containerClassName="gap-[7px]"
        />
        <View className="gap-[9px]">
          <Text className="font-sans-medium text-[13px] text-ink-600">
            ¿Cuánto entra? Elegí el volumen estándar
          </Text>
          <TierPicker
            testID="vehicle-info-manual-tier"
            value={draft.tierId}
            onChange={(tierId) => onChangeDraft({ tierId })}
          />
        </View>
      </View>
    </View>
  );
}

function PlateStep({
  draft,
  plate,
  format,
  tiersOpen,
  onToggleTiers,
  onChangePlate,
  onChangeFormat,
  onChangeTier,
  onChangeBrand,
}: {
  draft: Draft;
  plate: string;
  format: PlateFormat;
  tiersOpen: boolean;
  onToggleTiers: () => void;
  onChangePlate: (raw: string) => void;
  onChangeFormat: (format: PlateFormat) => void;
  onChangeTier: (tierId: string) => void;
  onChangeBrand: () => void;
}) {
  const tier = tierById(draft.tierId);
  const valid = isPlateValid(plate, format);
  const empty = plate.length === 0;
  const partial = !empty && !valid;

  return (
    <View>
      <View className="mb-[22px] flex-row items-center gap-3 rounded-lg bg-ink-50 px-3.5 py-3">
        <BrandAvatar
          brand={draft.brand || "?"}
          size={34}
          bgClassName="bg-white"
        />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text
            className="font-sans-medium text-[15px] text-ink-950"
            numberOfLines={1}
          >
            {draft.brand} {draft.model}
          </Text>
          <Text className="font-sans text-[11.5px] text-ink-400">
            {draft.segment
              ? `${draft.segment} · volumen ${draft.tierId}`
              : `Volumen ${draft.tierId}`}
          </Text>
        </View>
        <Pressable
          testID="vehicle-info-plate-change-brand"
          onPress={onChangeBrand}
        >
          <Text className="font-sans-medium text-[13px] text-[#6E8E1E] underline">
            Cambiar
          </Text>
        </Pressable>
      </View>

      <Text className="mb-2.5 font-sans-semibold text-[11px] uppercase tracking-wider text-ink-600">
        Patente
      </Text>
      <View className="mb-3 flex-row gap-2">
        <Pressable
          testID="vehicle-info-plate-format-mercosur"
          onPress={() => onChangeFormat("mercosur")}
          className={`flex-1 items-center rounded-full border-[1.5px] px-2 py-[9px] ${
            format === "mercosur"
              ? "border-ink-950 bg-ink-950"
              : "border-ink-950/[0.14] bg-white"
          }`}
        >
          <Text
            className={`font-sans-medium text-[12px] ${format === "mercosur" ? "text-white" : "text-ink-600"}`}
          >
            Mercosur · AB 123 CD
          </Text>
        </Pressable>
        <Pressable
          testID="vehicle-info-plate-format-old"
          onPress={() => onChangeFormat("old")}
          className={`flex-1 items-center rounded-full border-[1.5px] px-2 py-[9px] ${
            format === "old"
              ? "border-ink-950 bg-ink-950"
              : "border-ink-950/[0.14] bg-white"
          }`}
        >
          <Text
            className={`font-sans-medium text-[12px] ${format === "old" ? "text-white" : "text-ink-600"}`}
          >
            Anterior · ABC 123
          </Text>
        </Pressable>
      </View>

      <PlateInput
        testID="vehicle-info-plate-input"
        value={plate}
        format={format}
        onChangeText={onChangePlate}
      />

      {empty ? (
        <Text className="mt-2.5 font-sans text-[12.5px] leading-[18px] text-ink-400">
          Tocá los casilleros y escribí. Sin espacios ni guiones: detectamos el
          formato solo.
        </Text>
      ) : partial ? (
        <Text
          testID="vehicle-info-plate-error"
          className="mt-2.5 font-sans text-[12.5px] leading-[18px] text-danger-500"
        >
          {plateFormatErrorMessage(format)}
        </Text>
      ) : (
        <Text className="mt-2.5 font-sans text-[12.5px] leading-[18px] text-success-500">
          Patente válida · formato {formatLabel(format)}
        </Text>
      )}

      <Text className="mb-2.5 mt-[26px] font-sans-semibold text-[11px] uppercase tracking-wider text-ink-600">
        Volumen de carga
      </Text>
      <View className="overflow-hidden rounded-[10px] border-[1.5px] border-ink-950/[0.08]">
        <View
          className={`flex-row items-center gap-3 rounded-t-[8.5px] bg-white px-3.5 py-[15px] ${
            tiersOpen ? "" : "rounded-b-[8.5px]"
          }`}
        >
          <View className="h-[38px] min-w-[38px] items-center justify-center rounded-lg bg-ink-950 px-1.5">
            <Text className="font-mono-semibold text-[14px] text-lime-500">
              {draft.tierId}
            </Text>
          </View>
          <View className="min-w-0 flex-1 gap-[3px]">
            <Text className="font-sans-medium text-[14.5px] text-ink-950">
              {tier.cap}
            </Text>
            <Text className="font-sans text-[11.5px] text-ink-400">
              {tier.ex}
            </Text>
          </View>
          <Pressable testID="vehicle-info-toggle-tiers" onPress={onToggleTiers}>
            <Text className="font-sans-medium text-[13px] text-[#6E8E1E] underline">
              {tiersOpen ? "Listo" : "Ajustar"}
            </Text>
          </Pressable>
        </View>
        {tiersOpen ? (
          <View className="gap-2 rounded-b-[8.5px] border-t-[1.5px] border-ink-950/[0.08] bg-ink-50 p-3">
            <TierPicker
              testID="vehicle-info-plate-tier"
              value={draft.tierId}
              onChange={onChangeTier}
            />
          </View>
        ) : null}
      </View>
      <Text className="mt-2.5 font-sans text-[12px] leading-[18px] text-ink-400">
        Lo calculamos a partir del modelo. Ajustalo solo si tu auto lleva más o
        menos de lo normal.
      </Text>
    </View>
  );
}

function ViewStep({ draft, plate }: { draft: Draft; plate: string }) {
  const tier = tierById(draft.tierId);
  const fits = FITS_BY_TIER[draft.tierId] ?? FITS_BY_TIER.M;

  return (
    <View>
      <Text className="mb-[18px] font-sans text-[13.5px] leading-[21px] text-ink-600">
        Esta ficha se muestra en tu perfil público: quien recibe su paquete
        puede verificar el vehículo antes de entregártelo.
      </Text>
      <View className="overflow-hidden rounded-[14px] border-[1.5px] border-ink-950/[0.08]">
        <View className="relative overflow-hidden rounded-t-[12.5px] bg-ink-950 p-[22px]">
          <GridPattern color="#FFFFFF" opacity={0.06} />
          <View className="mb-4 flex-row items-center gap-2">
            <Text className="font-sans-semibold text-[11px] uppercase tracking-wider text-lime-500">
              Vehículo verificado
            </Text>
          </View>
          <Text className="font-sans-semibold text-[27px] tracking-[-0.03em] text-white">
            {draft.brand} {draft.model}
          </Text>
          <Text className="mt-1.5 font-sans text-[13.5px] text-ink-300">
            {draft.segment
              ? `${draft.segment} · volumen estándar ${draft.tierId}`
              : `Volumen estándar ${draft.tierId}`}
          </Text>
          <View className="mt-5 flex-row self-start rounded-md bg-white px-3.5 py-2">
            <Text className="font-mono-semibold text-[20px] tracking-[0.06em] text-ink-950">
              {plate}
            </Text>
          </View>
        </View>
        <View className="flex-row items-center gap-3 rounded-b-[12.5px] bg-white px-[18px] py-4">
          <View className="h-[38px] min-w-[38px] items-center justify-center rounded-lg bg-ink-100 px-1.5">
            <Text className="font-mono-semibold text-[14px] text-ink-950">
              {draft.tierId}
            </Text>
          </View>
          <View className="min-w-0 flex-1 gap-[3px]">
            <Text className="font-sans-medium text-[14.5px] text-ink-950">
              {tier.cap}
            </Text>
            <Text className="font-sans text-[11.5px] text-ink-400">
              {tier.ex}
            </Text>
          </View>
        </View>
      </View>
      <Text className="mb-3 mt-[26px] font-sans-semibold text-[11px] uppercase tracking-wider text-ink-600">
        Qué podés llevar
      </Text>
      <View className="gap-2">
        {fits.map((fit) => (
          <View
            key={fit}
            className="flex-row items-center gap-[11px] rounded-lg border border-ink-950/[0.08] bg-ink-50 px-3.5 py-[13px]"
          >
            <CheckCircle2 size={16} color="#2BB673" strokeWidth={2.4} />
            <Text className="flex-1 font-sans text-[13.5px] text-ink-950">
              {fit}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function EditStep({
  draft,
  plate,
  onEditBrand,
  onEditPlate,
}: {
  draft: Draft;
  plate: string;
  onEditBrand: () => void;
  onEditPlate: () => void;
}) {
  return (
    <View>
      <Text className="mb-3 font-sans-semibold text-[11px] uppercase tracking-wider text-ink-600">
        Vehículo
      </Text>
      <View className="gap-2">
        <Pressable
          testID="vehicle-info-edit-brand"
          onPress={onEditBrand}
          className="flex-row items-center gap-3 rounded-lg border-[1.5px] border-ink-950/[0.08] bg-white p-3.5"
        >
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="font-sans text-[11.5px] text-ink-400">
              Marca y modelo
            </Text>
            <Text className="font-sans-medium text-[15px] text-ink-950">
              {draft.brand} {draft.model}
            </Text>
          </View>
          <ChevronRight size={16} color="#B4B4BC" strokeWidth={2.2} />
        </Pressable>
        <Pressable
          testID="vehicle-info-edit-plate"
          onPress={onEditPlate}
          className="flex-row items-center gap-3 rounded-lg border-[1.5px] border-ink-950/[0.08] bg-white p-3.5"
        >
          <View className="min-w-0 flex-1 gap-0.5">
            <Text className="font-sans text-[11.5px] text-ink-400">
              Patente y volumen
            </Text>
            <Text className="font-mono-semibold text-[15px] tracking-[0.05em] text-ink-950">
              {plate} · {draft.tierId}
            </Text>
          </View>
          <ChevronRight size={16} color="#B4B4BC" strokeWidth={2.2} />
        </Pressable>
      </View>
      <Text className="mt-3.5 font-sans text-[12.5px] leading-[19px] text-ink-400">
        Por ahora podés tener un solo vehículo en Movo. Si cambiás de auto,
        editá esta ficha.
      </Text>
    </View>
  );
}
