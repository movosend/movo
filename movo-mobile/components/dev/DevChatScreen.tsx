import type { ChatListItem, ChatParticipant, ChatParticipantRole } from "@movo/shared/dist/types/chat";
import { ShipmentStatus } from "@movo/shared/dist/types/shipment";
import { router } from "expo-router";
import { useColorScheme } from "nativewind";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  CHAT_QUICK_REPLIES,
  buildChatTimeline,
  chatReadOnlyCopy,
  chatRoleLabel,
  shortName,
  type ChatEventCard as ChatEventCardData,
  type ChatTimelineItem,
  type LocalChatMessage,
} from "../../src/lib/chat-format";
import { ChatBubble } from "../chat/chat-bubble";
import { ChatComposer } from "../chat/chat-composer";
import { ChatDotBackground } from "../chat/chat-dot-background";
import { ChatEventCard } from "../chat/chat-event-card";
import { ChatHeader } from "../chat/chat-header";
import { ChatListRow } from "../chat/chat-list-row";
import { ChatSafetySheet } from "../chat/chat-safety-sheet";
import { ModerationBanner } from "../chat/moderation-banner";
import { QuickReplies } from "../chat/quick-replies";

/**
 * MOVO-284: galería del chat solo para desarrollo (`/dev-chat`), con los datos del prototipo "Chat del envío · v2"
 * (Ana M. emisora, Diego R. transportista, Luis P. receptor). Usa los mismos componentes y `buildChatTimeline` que
 * la pantalla real, pero no toca el backend ni el WebSocket: lo que se escribe se queda en memoria.
 */
const PEOPLE: Record<ChatParticipantRole, ChatParticipant> = {
  sender: { userId: "ana", role: "sender", firstName: "Ana", fullName: "Ana Molina", photoUrl: null },
  carrier: { userId: "diego", role: "carrier", firstName: "Diego", fullName: "Diego Ramos", photoUrl: null },
  receiver: { userId: "luis", role: "receiver", firstName: "Luis", fullName: "Luis Paz", photoUrl: null },
};
const PARTICIPANTS = [PEOPLE.sender, PEOPLE.carrier, PEOPLE.receiver];
const ROLES: ChatParticipantRole[] = ["sender", "carrier", "receiver"];

const SCENARIOS = [
  { id: "conversation", label: "En vivo" },
  { id: "empty", label: "Recién creado" },
  { id: "readonly", label: "Solo lectura" },
  { id: "blocked", label: "Bloqueado + fallido" },
] as const;
type ScenarioId = (typeof SCENARIOS)[number]["id"];

const at = (hh: number, mm: number) => {
  const d = new Date();
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
};

function msg(n: number, authorId: string, body: string, time: string, extra: Partial<LocalChatMessage> = {}): LocalChatMessage {
  const person = PARTICIPANTS.find((p) => p.userId === authorId);
  return {
    id: `dev-${n}`,
    shipmentId: "dev",
    authorId,
    authorName: person?.firstName ?? null,
    body,
    clientMessageId: `dev-c-${n}`,
    moderated: false,
    hidden: false,
    deliveryStatus: "read",
    createdAt: time,
    ...extra,
  };
}

/** Textos de las tarjetas según quién mira, tal cual los de `SEED`/`STAGES` del prototipo. */
function card(id: string, role: ChatParticipantRole, texts: { carrier: string; sender: string; receiver: string }, time: string, live = false): ChatEventCardData {
  const text = role === "carrier" ? texts.carrier : role === "receiver" ? texts.receiver : texts.sender;
  return { id, text, live, createdAt: time };
}

function scenarioData(id: ScenarioId, role: ChatParticipantRole, stage: number) {
  const accepted = card("ev1", role, { carrier: "Aceptaste el envío", sender: "Diego aceptó el envío", receiver: "Diego aceptó el envío" }, at(14, 2));
  const pickup = card("ev2", role, { carrier: "Escaneaste el QR de retiro", sender: "Diego escaneó el QR de retiro", receiver: "Diego retiró el paquete" }, at(14, 30));
  const onTheWay = card("ev5", role, { carrier: "Saliste hacia Belgrano", sender: "Diego salió hacia Belgrano", receiver: "Diego salió hacia tu domicilio" }, at(14, 35), true);
  const arriving = card("ev6", role, { carrier: "Estás llegando al destino", sender: "Diego está llegando al destino", receiver: "Diego está llegando" }, at(15, 13), true);
  const delivered = card("ev7", role, { carrier: "Luis confirmó la entrega con QR", sender: "Luis confirmó la entrega con QR", receiver: "Confirmaste la entrega con QR" }, at(15, 14));

  const base = [
    msg(3, "ana", "Hola Diego, el paquete va en la caja azul. Es frágil.", at(14, 31)),
    msg(4, "diego", "Perfecto, lo cuido. Salgo hacia Belgrano ahora.", at(14, 33)),
    msg(6, "luis", "Genial, ¿me avisás cuando estés cerca?", at(15, 5)),
    msg(7, "diego", "Dale, te escribo al llegar.", at(15, 7), { deliveryStatus: "delivered" }),
  ];
  const stageCards = [arriving, delivered].slice(0, stage);

  switch (id) {
    case "empty":
      return { messages: [], events: [accepted], canWrite: true };
    case "readonly":
      return {
        messages: [msg(20, "diego", "Ya estoy en la puerta.", at(11, 50)), msg(21, "luis", "Bajo ahora, gracias.", at(11, 51))],
        events: [{ ...delivered, text: "Entrega confirmada con QR", createdAt: at(11, 52) }],
        canWrite: false,
      };
    case "blocked":
      return {
        messages: [
          ...base.slice(0, 2),
          msg(10, "luis", "", at(15, 1), { hidden: true }),
          msg(11, "diego", "Estoy en la puerta", at(15, 8)),
          msg(12, "ana", "No pude enviar este mensaje", at(15, 9), { id: "", deliveryStatus: null, localState: "failed", clientMessageId: "dev-failed" }),
        ],
        events: [accepted, pickup, onTheWay],
        canWrite: true,
      };
    default:
      return { messages: base, events: [accepted, pickup, onTheWay, ...stageCards], canWrite: stage < 2 };
  }
}

const LIST: { item: ChatListItem; title: string }[] = [
  { title: "MV-2841", item: { shipmentId: "a-02841", status: ShipmentStatus.IN_TRANSIT, route: "Palermo → Belgrano", access: "open", archived: false, unreadCount: 2, lastMessage: { authorId: "diego", authorName: "Diego", body: "Dale, te escribo al llegar.", hidden: false, createdAt: at(15, 7) }, lastActivityAt: at(15, 7), participants: PARTICIPANTS } },
  { title: "MV-2903", item: { shipmentId: "b-02903", status: ShipmentStatus.ASSIGNED, route: "Recoleta → Caballito", access: "open", archived: false, unreadCount: 1, lastMessage: null, lastActivityAt: at(15, 10), participants: PARTICIPANTS } },
  { title: "MV-2790", item: { shipmentId: "c-02790", status: ShipmentStatus.DELIVERED, route: "Núñez → Villa Urquiza", access: "read_only", archived: false, unreadCount: 0, lastMessage: { authorId: "luis", authorName: "Luis", body: "Entrega confirmada con QR", hidden: false, createdAt: new Date(Date.now() - 86_400_000).toISOString() }, lastActivityAt: new Date(Date.now() - 86_400_000).toISOString(), participants: PARTICIPANTS } },
  { title: "MV-2744", item: { shipmentId: "d-02744", status: ShipmentStatus.DELIVERED, route: "Almagro → Flores", access: "read_only", archived: true, unreadCount: 0, lastMessage: { authorId: "ana", authorName: "Ana", body: "Gracias por todo, Diego", hidden: false, createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }, lastActivityAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), participants: PARTICIPANTS } },
];

function Pill({ label, active, onPress, testID }: { label: string; active: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} onPress={onPress} className={`items-center justify-center rounded-full border ${active ? "border-lime-500 bg-lime-500" : "border-border-strong bg-bg"}`} style={{ height: 38, paddingHorizontal: 16 }}>
      <Text className={`font-sans-semibold text-small ${active ? "text-ink-950" : "text-fg"}`}>{label}</Text>
    </Pressable>
  );
}

const STAGE_LABELS = ["Simular: llegando", "Simular: entregado", "Envío entregado"];

export default function DevChatScreen() {
  const { colorScheme, setColorScheme } = useColorScheme();
  const [scenario, setScenario] = useState<ScenarioId>("conversation");
  const [role, setRole] = useState<ChatParticipantRole>("sender");
  const [stage, setStage] = useState(0);
  const [extra, setExtra] = useState<LocalChatMessage[]>([]);
  const [safetyOpen, setSafetyOpen] = useState(false);
  const [blocked, setBlocked] = useState<Set<string>>(new Set());
  const [reported, setReported] = useState(false);
  const [warning, setWarning] = useState(false);

  const me = PEOPLE[role];
  const data = useMemo(() => scenarioData(scenario, role, stage), [scenario, role, stage]);
  const timeline = useMemo(
    () => buildChatTimeline({ messages: [...data.messages, ...extra], events: data.events, currentUserId: me.userId }),
    [data, extra, me.userId],
  );
  const isEmpty = data.messages.length === 0 && extra.length === 0;
  const dark = colorScheme === "dark";

  const changeScenario = (id: ScenarioId) => {
    setScenario(id);
    setExtra([]);
    setStage(0);
  };

  const send = (body: string) => {
    const n = extra.length + 100;
    const created = new Date().toISOString();
    setExtra((prev) => [...prev, msg(n, me.userId, body, created, { deliveryStatus: "sent" })]);
    // Igual que el prototipo: pasa a entregado a los 0,9 s y a leído a los 2,6 s.
    const set = (status: "delivered" | "read") => setExtra((prev) => prev.map((m) => (m.id === `dev-${n}` ? { ...m, deliveryStatus: status } : m)));
    setTimeout(() => set("delivered"), 900);
    setTimeout(() => set("read"), 2600);
    return true;
  };

  const renderItem = (item: ChatTimelineItem) => {
    if (item.kind === "day") {
      return (
        <View key={item.key} className="items-center" style={{ marginTop: 6, marginBottom: 6 }}>
          <Text className="font-sans-medium text-caption uppercase text-fg-3">{item.label}</Text>
        </View>
      );
    }
    if (item.kind === "event") return <ChatEventCard key={item.key} card={item.card} />;
    const author = PARTICIPANTS.find((p) => p.userId === item.message.authorId);
    const isBlocked = blocked.has(item.message.authorId);
    return (
      <ChatBubble
        key={item.key}
        testID={`dev-chat-${item.message.clientMessageId}`}
        message={isBlocked ? { ...item.message, hidden: true } : item.message}
        mine={item.mine}
        authorLabel={author ? `${shortName(author.fullName)} · ${chatRoleLabel(author.role)}` : undefined}
        showName={item.showName}
        showAvatar={item.showAvatar}
        groupStart={item.groupStart}
        avatar={author ? { fullName: author.fullName, photoUrl: null } : undefined}
        onRetry={() => undefined}
        onDiscard={() => undefined}
      />
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <View className="px-4 pt-3" style={{ gap: 4 }}>
          <Text className="font-sans-semibold text-caption uppercase text-fg-3">Chat del envío · v2</Text>
          <Text className="font-sans-semibold text-title text-fg">Emisor, transportista y receptor</Text>
          <Text className="font-sans text-small text-fg-3">Un grupo por envío. Datos de prueba, no toca el backend.</Text>
        </View>

        <View className="flex-row flex-wrap px-4 pt-4" style={{ gap: 8 }}>
          <Pressable testID="dev-chat-back" onPress={() => router.back()} className="items-center justify-center rounded-full border border-border-strong bg-bg" style={{ height: 38, paddingHorizontal: 16 }}>
            <Text className="font-sans-semibold text-small text-fg">← Volver</Text>
          </Pressable>
          <Pill testID="dev-chat-advance" label={STAGE_LABELS[stage] ?? STAGE_LABELS[2]} active onPress={() => setStage((s) => Math.min(s + 1, 2))} />
          <Pill testID="dev-chat-theme" label={dark ? "Tema oscuro · cambiar a claro" : "Tema claro · cambiar a oscuro"} active={false} onPress={() => setColorScheme(dark ? "light" : "dark")} />
        </View>

        <Text className="px-4 pb-2 pt-5 font-sans-semibold text-caption uppercase text-fg-3">Estado</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
          {SCENARIOS.map((s) => (
            <Pill key={s.id} testID={`dev-chat-scenario-${s.id}`} label={s.label} active={scenario === s.id} onPress={() => changeScenario(s.id)} />
          ))}
        </ScrollView>

        <Text className="px-4 pb-2 pt-4 font-sans-semibold text-caption uppercase text-fg-3">Yo soy</Text>
        <View className="flex-row px-4" style={{ gap: 8 }}>
          {ROLES.map((r) => (
            <Pill key={r} testID={`dev-chat-role-${r}`} label={`${chatRoleLabel(r)} · ${shortName(PEOPLE[r].fullName)}`} active={role === r} onPress={() => setRole(r)} />
          ))}
        </View>

        <View className="mx-4 mt-5 overflow-hidden bg-bg" style={{ borderRadius: 24, borderWidth: 1, borderColor: dark ? "rgba(255,255,255,0.1)" : "rgba(10,10,11,0.08)" }}>
          <ChatHeader participants={PARTICIPANTS} onBack={() => router.back()} onOptions={data.canWrite ? () => setSafetyOpen(true) : undefined} />

          <View style={{ marginTop: 10, minHeight: 300, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8 }}>
            <ChatDotBackground />
            {isEmpty ? (
              <View testID="dev-chat-empty" className="items-center justify-center" style={{ gap: 18, padding: 24, minHeight: 300 }}>
                {[...timeline].reverse().map((item) => (item.kind === "event" ? <ChatEventCard key={item.key} card={item.card} /> : null))}
                <View className="border border-border bg-bg" style={{ borderRadius: 14, padding: 18, gap: 6 }}>
                  <Text className="font-sans-semibold text-body text-fg">Coordinen acá</Text>
                  <Text className="font-sans text-fg-2" style={{ fontSize: 13, lineHeight: 20 }}>
                    Lo ven el emisor, el transportista y el receptor. Se cierra 24 h después de finalizado el envío.
                  </Text>
                </View>
              </View>
            ) : (
              <View>{[...timeline].reverse().map(renderItem)}</View>
            )}
          </View>

          <ModerationBanner visible={warning} onDismiss={() => setWarning(false)} />
          {data.canWrite ? <QuickReplies testID="dev-chat-quick" replies={CHAT_QUICK_REPLIES[role]} onPick={send} /> : null}
          <ChatComposer
            testID="dev-chat-composer"
            canWrite={data.canWrite}
            readOnlyCopy={chatReadOnlyCopy({ archived: false, status: ShipmentStatus.DELIVERED, isFormerReceiver: false })}
            onSend={send}
          />
        </View>

        <Text className="px-4 pb-2 pt-5 font-sans-semibold text-caption uppercase text-fg-3">Simular</Text>
        <View className="flex-row flex-wrap px-4" style={{ gap: 8 }}>
          <Pill testID="dev-chat-incoming" label="Mensaje en vivo" active={false} onPress={() => setExtra((prev) => [...prev, msg(prev.length + 200, (PARTICIPANTS.find((p) => p.userId !== me.userId && !blocked.has(p.userId)) ?? PEOPLE.carrier).userId, "Mensaje nuevo que llegó en vivo", new Date().toISOString(), { deliveryStatus: null })])} />
          <Pill testID="dev-chat-warning" label="Advertencia de lenguaje" active={false} onPress={() => setWarning(true)} />
        </View>

        <Text className="font-sans-semibold text-title text-fg" style={{ paddingHorizontal: 20, paddingTop: 28, paddingBottom: 4 }}>Chats</Text>
        <Text className="font-sans text-small text-fg-3" style={{ paddingHorizontal: 20, paddingBottom: 14 }}>Uno por cada envío en curso</Text>
        <View style={{ gap: 10, paddingHorizontal: 14 }}>
          {LIST.map(({ item }) => (
            <ChatListRow
              key={item.shipmentId}
              testID={`dev-chat-row-${item.shipmentId}`}
              item={item}
              meId="ana"
              onPress={() => undefined}
            />
          ))}
        </View>
      </ScrollView>

      <ChatSafetySheet
        visible={safetyOpen}
        onClose={() => setSafetyOpen(false)}
        targets={PARTICIPANTS.filter((p) => p.userId !== me.userId).map((p) => ({ userId: p.userId, name: p.firstName, blocked: blocked.has(p.userId) }))}
        reported={reported}
        busy={false}
        onToggleBlock={(t) =>
          setBlocked((prev) => {
            const next = new Set(prev);
            if (next.has(t.userId)) next.delete(t.userId);
            else next.add(t.userId);
            return next;
          })
        }
        onReport={() => setReported(true)}
      />
    </SafeAreaView>
  );
}
