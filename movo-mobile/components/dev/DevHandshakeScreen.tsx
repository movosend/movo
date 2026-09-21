import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { HandshakeConfirmationResult } from "../handshake/handshake-confirmation-result";
import { HandshakeScanStep } from "../handshake/handshake-scan-step";
import type { ConfirmHandshakeResult, ShipmentSummary } from "../../src/api/shipments-client";
import { shipmentsClient } from "../../src/api/shipments-client";
import { signHandshakeNonce } from "../../src/crypto/signing";
import { useAuthStore } from "../../src/store/auth-store";
import { getCurrentLocation } from "../../src/lib/location";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import { shipmentStatusLabel, shortAddressLabel } from "../../src/lib/shipment-format";
import { ErrorBanner } from "../ui/error-banner";
import { PrimaryButton } from "../auth/primary-button";
import { TextField } from "../ui/text-field";

type MyRole = "sender" | "carrier" | "receiver" | "none";
type Stage = "pickup" | "delivery" | null;

function resolveRole(shipment: ShipmentSummary, currentUserId: string | null): MyRole {
  if (!currentUserId) return "none";
  if (shipment.senderId === currentUserId) return "sender";
  if (shipment.carrierId === currentUserId) return "carrier";
  if (shipment.receiverId === currentUserId) return "receiver";
  return "none";
}

function resolveStage(shipment: ShipmentSummary): Stage {
  if (shipment.status === "assigned") return "pickup";
  if (shipment.status === "in_transit") return "delivery";
  return null;
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3 border-b border-border py-2.5">
      <Text className="font-sans text-[12px] text-fg-3">{label}</Text>
      <Text className="font-sans text-[13px] text-fg">{value}</Text>
    </View>
  );
}

/**
 * Sección "generar QR de prueba" — hace lo que haría la pantalla real de `MOVO-159`
 * (todavía sin construir): pide GPS, llama a `generate`, firma el `canonicalPayload`
 * con la clave del dispositivo (`MOVO-195`) y arma el mismo JSON que espera
 * `HandshakeScanStep` (`{shipmentId, nonce, signature}`). Solo tiene sentido cuando
 * la cuenta logueada es el CEDENTE de la etapa pendiente — para probar de punta a
 * punta con dos partes reales hace falta una segunda cuenta/dispositivo logueado
 * como la contraparte, que pega el JSON generado acá en su propio paso de escaneo.
 */
function GenerateQrSection({ shipmentId }: { shipmentId: string }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payloadJson, setPayloadJson] = useState<string | null>(null);
  const [ttlSeconds, setTtlSeconds] = useState<number | null>(null);

  async function handleGenerate() {
    setIsGenerating(true);
    setError(null);
    setPayloadJson(null);
    try {
      const location = await getCurrentLocation();
      if (!location.granted) {
        setError("Necesitamos tu ubicación para generar el QR de prueba.");
        return;
      }
      const generated = await shipmentsClient.generateHandshake(shipmentId, {
        lat: location.lat,
        lng: location.lng,
      });
      const signature = await signHandshakeNonce(generated.canonicalPayload);
      setPayloadJson(JSON.stringify({ shipmentId: generated.shipmentId, nonce: generated.nonce, signature }));
      setTtlSeconds(generated.ttlSeconds);
    } catch (err) {
      setError(friendlyErrorMessage(err, "No pudimos generar el QR de prueba."));
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <View className="gap-3 rounded-[10px] border border-border p-4">
      <Text className="font-sans-semibold text-[13px] text-fg">Generar QR de prueba (cedente)</Text>
      <Text className="font-sans text-[12px] text-fg-3">
        Firma un nonce real con la clave de este dispositivo. Vence en 15s — copiá y pegalo en el paso de
        escaneo (de esta misma pantalla en otra sesión, o de otro dispositivo) antes de que expire.
      </Text>
      <PrimaryButton
        testID="dev-handshake-generate"
        label="Generar y firmar"
        loading={isGenerating}
        onPress={handleGenerate}
      />
      <ErrorBanner testID="dev-handshake-generate-error" message={error} />
      {payloadJson ? (
        <View testID="dev-handshake-generated-payload" className="gap-1.5 rounded-[8px] bg-bg-mute p-3">
          <Text className="font-sans text-[11px] text-fg-3">
            JSON del QR (TTL {ttlSeconds}s) — tocá y mantené para copiar:
          </Text>
          <Text selectable className="font-mono text-[12px] text-fg">
            {payloadJson}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

/**
 * Pantalla de dev para probar MOVO-160 (escaneo + GPS + confirmación) contra el
 * backend real, sin esperar a `MOVO-159` (la pantalla de generación de QR, todavía
 * sin construir) — reusa `HandshakeScanStep`/`HandshakeConfirmationResult` tal cual
 * son en producción, sin reimplementarlos. Ruta: `/dev-handshake`, sin link desde la
 * app (mismo criterio que `/dev-tokens`/`/dev-connection`/`/dev-home-operativo`).
 */
export default function DevHandshakeScreen() {
  const currentUserId = useAuthStore((state) => state.user?.userId ?? null);

  const [myShipments, setMyShipments] = useState<ShipmentSummary[] | null>(null);
  const [myShipmentsError, setMyShipmentsError] = useState<string | null>(null);

  const [shipmentIdInput, setShipmentIdInput] = useState("");
  const [shipment, setShipment] = useState<ShipmentSummary | null>(null);
  const [isLoadingShipment, setIsLoadingShipment] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [confirmedResult, setConfirmedResult] = useState<ConfirmHandshakeResult | null>(null);

  useEffect(() => {
    shipmentsClient
      .listMine({ limit: 20 })
      .then((res) => setMyShipments(res.items))
      .catch((err) => setMyShipmentsError(friendlyErrorMessage(err, "No pudimos cargar tus envíos.")));
  }, []);

  async function loadShipment(id: string) {
    const trimmed = id.trim();
    if (!trimmed) return;
    setIsLoadingShipment(true);
    setLoadError(null);
    setShipment(null);
    setConfirmedResult(null);
    try {
      const loaded = await shipmentsClient.getById(trimmed);
      setShipment(loaded);
      setShipmentIdInput(trimmed);
    } catch (err) {
      setLoadError(friendlyErrorMessage(err, "No pudimos cargar ese envío."));
    } finally {
      setIsLoadingShipment(false);
    }
  }

  const role = shipment ? resolveRole(shipment, currentUserId) : "none";
  const stage = shipment ? resolveStage(shipment) : null;

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <ScrollView contentContainerClassName="gap-5 px-5 pb-10 pt-3" keyboardShouldPersistTaps="handled">
        <Text className="font-sans-semibold text-title text-fg">Handshake — prueba (dev)</Text>
        <Text className="font-sans text-[12px] text-fg-3">
          Elegí un envío tuyo (como emisor) o pegá el ID de uno donde participes como transportista o
          receptor, en {"assigned"} o {"in_transit"}. Sin ningún CTA de producción todavía —
          `MOVO-198`/`MOVO-199`/`MOVO-193` fase 2 lo van a cablear cuando existan.
        </Text>

        <View className="gap-2">
          <Text className="font-sans-medium text-[12px] text-fg-2">Tus envíos (como emisor)</Text>
          <ErrorBanner testID="dev-handshake-mine-error" message={myShipmentsError} />
          {myShipments === null && !myShipmentsError ? <ActivityIndicator /> : null}
          {myShipments?.length === 0 ? (
            <Text className="font-sans text-[12px] text-fg-3">No tenés envíos propios todavía.</Text>
          ) : null}
          {myShipments?.map((item) => (
            <Pressable
              key={item.id}
              testID={`dev-handshake-mine-${item.id}`}
              onPress={() => void loadShipment(item.id)}
              className={`gap-1 rounded-[8px] border p-3 ${
                shipment?.id === item.id ? "border-fg" : "border-border"
              }`}
            >
              <Text className="font-sans-medium text-[13px] text-fg">{shipmentStatusLabel(item.status)}</Text>
              <Text className="font-sans text-[12px] text-fg-3">
                {shortAddressLabel(item.pickupAddress)} → {shortAddressLabel(item.deliveryAddress)}
              </Text>
            </Pressable>
          ))}
        </View>

        <View className="gap-2">
          <TextField
            testID="dev-handshake-id-input"
            label="O pegá un ID de envío"
            value={shipmentIdInput}
            onChangeText={setShipmentIdInput}
            autoCapitalize="none"
            placeholder="uuid del envío"
          />
          <PrimaryButton
            testID="dev-handshake-load"
            label="Cargar envío"
            loading={isLoadingShipment}
            onPress={() => void loadShipment(shipmentIdInput)}
          />
          <ErrorBanner testID="dev-handshake-load-error" message={loadError} />
        </View>

        {shipment ? (
          <View className="gap-4">
            <View className="rounded-[10px] border border-border px-3.5">
              <InfoRow label="Envío" value={shipment.id} />
              <InfoRow label="Estado" value={shipmentStatusLabel(shipment.status)} />
              <InfoRow
                label="Tu rol acá"
                value={
                  role === "sender" ? "Emisor" : role === "carrier" ? "Transportista" : role === "receiver" ? "Receptor" : "Ninguno"
                }
              />
              <InfoRow
                label="Etapa pendiente"
                value={stage === "pickup" ? "Retiro" : stage === "delivery" ? "Entrega" : "Ninguna (no aplica)"}
              />
            </View>

            {!confirmedResult ? (
              <>
                <GenerateQrSection shipmentId={shipment.id} />

                <View className="gap-2">
                  <Text className="font-sans-semibold text-[13px] text-fg">Escanear / confirmar (receptor)</Text>
                  <View className="h-[520px] overflow-hidden rounded-[14px]">
                    <HandshakeScanStep
                      testID="dev-handshake-scan-step"
                      shipmentId={shipment.id}
                      onConfirmed={setConfirmedResult}
                    />
                  </View>
                </View>
              </>
            ) : (
              <View className="h-[420px] overflow-hidden rounded-[14px] border border-border">
                <HandshakeConfirmationResult testID="dev-handshake-confirmation-result" result={confirmedResult} />
              </View>
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
