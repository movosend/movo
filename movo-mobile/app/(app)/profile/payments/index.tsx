import { ApiError } from "@movo/shared/dist/errors/api-error";
import type { SavedCard } from "@movo/shared/dist/types/saved-card";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { CardOptionsSheet } from "../../../../components/payments/card-options-sheet";
import { BalanceTab } from "../../../../components/payments/balance-tab";
import { DeleteCardSheet } from "../../../../components/payments/delete-card-sheet";
import { HistoryTab } from "../../../../components/payments/history-tab";
import { MpAccountSheet } from "../../../../components/payments/mp-account-sheet";
import { ChangeMpAccountSheet } from "../../../../components/payments/change-mp-account-sheet";
import { MpConnectCard, MpConnectSkeletonCard } from "../../../../components/payments/mp-connect-card";
import { PaymentsToast } from "../../../../components/payments/payments-toast";
import { RenameCardSheet } from "../../../../components/payments/rename-card-sheet";
import { SavedCardsList, SavedCardsSkeleton } from "../../../../components/payments/saved-cards-list";
import { UnlinkMpSheet } from "../../../../components/payments/unlink-mp-sheet";
import { ErrorBanner } from "../../../../components/ui/error-banner";
import { useBalance } from "../../../../src/hooks/use-balance";
import { useLinkMpAccount, useMpConnectStatus, useUnlinkMpAccount } from "../../../../src/hooks/use-mp-connect";
import { useDeleteCard, useRenameCard, useSavedCards, useSetDefaultCard } from "../../../../src/hooks/use-saved-cards";
import { useThemeColors } from "../../../../src/hooks/use-theme-colors";
import { friendlyErrorMessage } from "../../../../src/lib/error-messages";
import {
  defaultCardToast,
  deletedCardToast,
  renamedCardToast,
} from "../../../../src/lib/saved-cards";

type CardOverlay = "options" | "rename" | "delete";
type MpOverlay = "account" | "unlink" | "change";
type PaymentsTab = "balance" | "history" | "methods";
const PAYMENTS_TABS: readonly PaymentsTab[] = ["balance", "history", "methods"];
const parseTab = (tab: string | undefined): PaymentsTab | null =>
  PAYMENTS_TABS.includes(tab as PaymentsTab) ? (tab as PaymentsTab) : null;

const TAB_LABELS: Record<PaymentsTab, string> = { balance: "Saldo", history: "Historial", methods: "Medios" };

/**
 * "Pagos y cobros" (MOVO-112), desde Perfil → Configuración.
 *
 * Fiel al prototipo de Claude Design "MOVO-112 Pagos y cobros v3": las dos secciones usan
 * la misma lista (recuadro de marca, título, detalle y menú) y sus opciones se abren en
 * hojas con el mismo armado.
 *
 * Arriba, "Medios de pago" (MOVO-101): las tarjetas guardadas de cualquier usuario, con
 * alta (`profile/payments/add-card`), predeterminada, nombre de referencia y baja.
 * Renombrar y el aviso de `409 CARD_IN_USE` no están en el prototipo y reusan sus piezas.
 *
 * Abajo, "Medios de cobro": el transportista vincula, consulta, cambia y desvincula su
 * cuenta de Mercado Pago (MOVO-111). Desvincular está dentro de las opciones de la cuenta,
 * igual que eliminar una tarjeta. Desvíos del prototipo:
 *
 * - Un error al vincular (cancelar en MP, deep link con error) es un banner arriba del
 *   estado REAL, que se vuelve a consultar. El mockup siempre volvía a "Sin vincular",
 *   que es falso si la vinculación estaba "inválida" antes de reintentar.
 * - Si falla consultar el status, se muestra el error con "Reintentar" en vez de la
 *   tarjeta (el mockup no tenía este estado). Si el backend responde que la vinculación
 *   no está configurada (503 `MP_CONNECT_NOT_CONFIGURED`), reintentar no sirve: se muestra
 *   solo el aviso, sin botón.
 */
export default function PaymentsSettingsScreen() {
  const colors = useThemeColors();
  const statusQuery = useMpConnectStatus();
  const link = useLinkMpAccount();
  const [mpOverlay, setMpOverlay] = useState<MpOverlay | null>(null);
  // Igual que con las tarjetas: desvincular (otra hoja) o abrir el navegador de MP se hace
  // recién cuando la hoja de opciones terminó de cerrarse, porque iOS no presenta nada
  // mientras un `Modal` se está cerrando.
  const nextMpActionRef = useRef<"link" | "unlink" | "change" | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);

  const cardsQuery = useSavedCards();
  const params = useLocalSearchParams<{ toast?: string; tab?: string; pay?: string }>();
  // Se abre en Saldo si hay deuda y, si no, en Historial (prototipo "Pagos y cobros 2c"); un `?tab=`
  // explícito manda. Mientras el saldo carga se muestra Saldo, que ya tiene su propio indicador.
  const balanceQuery = useBalance();
  const [pickedTab, setPickedTab] = useState<PaymentsTab | null>(() => params.pay === "1" ? "balance" : parseTab(params.tab));
  const balanceArs = balanceQuery.data?.pages[0]?.balanceArs;
  const activeTab: PaymentsTab = pickedTab ?? "balance";
  useEffect(() => {
    const requestedTab = parseTab(params.tab);
    if (params.pay === "1") setPickedTab("balance");
    else if (requestedTab) setPickedTab(requestedTab);
  }, [params.tab, params.pay]);
  useEffect(() => {
    if (pickedTab === null && params.pay !== "1" && !parseTab(params.tab) &&
        (balanceArs !== undefined || balanceQuery.isError)) {
      setPickedTab(balanceArs !== undefined && balanceArs <= 0 ? "history" : "balance");
    }
  }, [pickedTab, params.tab, params.pay, balanceArs, balanceQuery.isError]);
  const [toast, setToast] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<SavedCard | null>(null);
  const [overlay, setOverlay] = useState<CardOverlay | null>(null);
  // iOS no presenta un `Modal` mientras otro se está cerrando: la hoja siguiente se abre
  // desde el `onClosed` de la de opciones (ver `BottomSheetModal#onClosed`).
  const nextOverlayRef = useRef<CardOverlay | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const [cardInUse, setCardInUse] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // El aviso de "Guardamos tu tarjeta" llega por param desde el alta.
  useEffect(() => {
    if (params.toast) {
      setToast(params.toast);
      router.setParams({ toast: undefined });
    }
  }, [params.toast]);
  const hideToast = useCallback(() => setToast(null), []);

  const openCard = (card: SavedCard) => {
    setCardError(null);
    setCardInUse(false);
    setRenameError(null);
    setSelectedCard(card);
    setOverlay("options");
  };
  const goFromOptions = (next: CardOverlay) => {
    nextOverlayRef.current = next;
    setOverlay(null);
  };

  const setDefault = useSetDefaultCard({
    onSuccess: (card) => {
      setOverlay(null);
      setToast(defaultCardToast(card));
    },
    onError: (err) => {
      setOverlay(null);
      setCardError(friendlyErrorMessage(err, "No pudimos cambiar tu tarjeta predeterminada. Probá de nuevo."));
    },
  });
  const rename = useRenameCard({
    onSuccess: (card) => {
      setOverlay(null);
      setToast(renamedCardToast(card));
    },
    onError: (err) => {
      setRenameError(friendlyErrorMessage(err, "No pudimos guardar el nombre. Probá de nuevo."));
    },
  });
  const removeCard = useDeleteCard({
    onSuccess: (card) => {
      setOverlay(null);
      setToast(deletedCardToast(card));
    },
    onError: (err) => {
      const inUse = err instanceof ApiError && err.code === "CARD_IN_USE";
      setCardInUse(inUse);
      setCardError(friendlyErrorMessage(err, "No pudimos eliminar la tarjeta. Probá de nuevo."));
    },
  });

  // `VALIDATION_FAILED` trae el motivo concreto del backend (largo, caracteres, número de
  // tarjeta): se muestra tal cual debajo del campo.
  const handleRename = (alias: string | null) => {
    if (!selectedCard) return;
    setRenameError(null);
    rename.mutate(
      { id: selectedCard.id, alias },
      {
        onError: (err) => {
          if (err instanceof ApiError && err.code === "VALIDATION_FAILED") setRenameError(err.message);
        },
      },
    );
  };

  const openAddCard = () => router.push("/profile/payments/add-card");

  const unlink = useUnlinkMpAccount({
    onSuccess: () => {
      setMpOverlay(null);
      setToast("Desvinculaste Mercado Pago.");
    },
    onError: (err) => {
      setMpOverlay(null);
      setUnlinkError(friendlyErrorMessage(err, "No pudimos desvincular tu cuenta. Probá de nuevo."));
    },
  });

  // Al volver a la pantalla (ej. desde la app de Mercado Pago) el status puede haber
  // cambiado. Durante un intento de vincular no: ese flujo ya consulta al final. La fase
  // va por ref y no como dependencia: si no, al volver a `idle` tras vincular el efecto se
  // re-dispararía y haría un refetch de más justo después del que ya hizo el flujo.
  const { refetch } = statusQuery;
  const refetchCards = cardsQuery.refetch;
  const linkPhaseRef = useRef(link.phase);
  linkPhaseRef.current = link.phase;
  // Las tarjetas no se piden en el primer foco (ya las trae la query al montar) ni mientras
  // el caché está fresco (por ejemplo, al volver del alta, que ya lo dejó al día).
  const cardsStaleRef = useRef(cardsQuery.isStale);
  cardsStaleRef.current = cardsQuery.isStale;
  const firstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (linkPhaseRef.current === "idle") void refetch();
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      if (cardsStaleRef.current) void refetchCards();
    }, [refetch, refetchCards]),
  );

  const handleLink = async () => {
    setUnlinkError(null);
    if (await link.start()) setToast("Vinculaste tu cuenta de Mercado Pago.");
  };
  const goFromMpAccount = (next: "link" | "unlink" | "change") => {
    nextMpActionRef.current = next;
    setMpOverlay(null);
  };

  const data = statusQuery.data;
  const showFinishing = link.phase === "finishing";

  let content: React.ReactNode;
  if (showFinishing) {
    content = <MpConnectSkeletonCard testID="mp-connect-finishing" message="Terminando la vinculación…" />;
  } else if (data) {
    content = (
      <MpConnectCard
        data={data}
        linking={link.phase !== "idle"}
        hadLinkError={link.error !== null}
        onLink={() => void handleLink()}
        onChangeAccount={() => setMpOverlay("change")}
        onOpenAccount={() => {
          setUnlinkError(null);
          link.clearError();
          setMpOverlay("account");
        }}
      />
    );
  } else if (statusQuery.isError) {
    const notConfigured =
      statusQuery.error instanceof ApiError && statusQuery.error.code === "MP_CONNECT_NOT_CONFIGURED";
    content = (
      <View testID="mp-connect-status-error">
        <ErrorBanner
          message={friendlyErrorMessage(statusQuery.error, "No pudimos consultar tu cuenta de Mercado Pago.")}
        />
        {notConfigured ? null : (
          <Pressable
            testID="mp-connect-status-retry"
            accessibilityRole="button"
            accessibilityLabel="Reintentar"
            onPress={() => void refetch()}
            className="items-center rounded-lg border border-border-strong bg-bg py-3 active:opacity-80"
          >
            <Text className="font-sans-semibold text-[14px] text-fg">Reintentar</Text>
          </Pressable>
        )}
      </View>
    );
  } else {
    content = <MpConnectSkeletonCard testID="mp-connect-loading" message="Consultando el estado de tu cuenta…" />;
  }

  let cardsContent: React.ReactNode;
  if (cardsQuery.data) {
    cardsContent = <SavedCardsList cards={cardsQuery.data} onOpenCard={openCard} onAdd={openAddCard} />;
  } else if (cardsQuery.isError) {
    cardsContent = (
      <View testID="saved-cards-error">
        <ErrorBanner message={friendlyErrorMessage(cardsQuery.error, "No pudimos cargar tus tarjetas.")} />
        <Pressable
          testID="saved-cards-retry"
          accessibilityRole="button"
          accessibilityLabel="Reintentar"
          onPress={() => void refetchCards()}
          className="items-center rounded-lg border border-border-strong bg-bg py-3 active:opacity-80"
        >
          <Text className="font-sans-semibold text-[14px] text-fg">Reintentar</Text>
        </Pressable>
      </View>
    );
  } else {
    cardsContent = <SavedCardsSkeleton />;
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={["top", "bottom"]}>
      <View className="flex-row items-center gap-3 px-5 pb-3.5 pt-1.5">
        <Pressable
          testID="payments-back"
          accessibilityRole="button"
          accessibilityLabel="Volver"
          onPress={() => router.back()}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
        <Text className="font-sans-semibold text-[17px] leading-[22px] text-fg">Pagos y cobros</Text>
      </View>

      <View accessibilityRole="tablist" className="flex-row gap-[22px] border-b border-border px-5">
        {PAYMENTS_TABS.map((tab) => (
          <Pressable key={tab} testID={`payments-tab-${tab}`} accessibilityRole="tab" accessibilityState={{ selected: activeTab === tab }} onPress={() => setPickedTab(tab)} className={`border-b-2 pb-2.5 pt-2 ${activeTab === tab ? "border-fg" : "border-transparent"}`}>
            <Text className={`font-sans-medium text-[13px] ${activeTab === tab ? "text-fg" : "text-fg-3"}`}>{TAB_LABELS[tab]}</Text>
          </Pressable>
        ))}
      </View>

      {activeTab === "balance" ? <BalanceTab openPay={params.pay === "1"} onPayOpened={() => router.setParams({ pay: undefined })} /> : activeTab === "history" ? <HistoryTab /> : (

      <ScrollView
        testID="payments-screen-content"
        contentContainerClassName="gap-4 px-5 pb-8 pt-3"
        showsVerticalScrollIndicator={false}
      >
        <View className="gap-1">
          <Text className="font-sans-semibold text-caption uppercase text-fg-3">Medios de pago</Text>
          <Text className="font-sans text-[13px] leading-[18px] text-fg-2">
            La marcada es la que te proponemos al pagar.
          </Text>
        </View>
        {cardError && overlay !== "delete" ? (
          <View testID="saved-cards-action-error">
            <ErrorBanner message={cardError} />
          </View>
        ) : null}
        {cardsContent}

        <View className="mt-3 gap-1">
          <Text className="font-sans-semibold text-caption uppercase text-fg-3">Medios de cobro</Text>
          <Text className="font-sans text-[13px] leading-[18px] text-fg-2">
            Acá se acredita lo que ganás llevando envíos.
          </Text>
        </View>
        {link.error && !showFinishing ? (
          <View testID="mp-connect-link-error">
            <ErrorBanner message={link.error} />
          </View>
        ) : null}
        {unlinkError ? (
          <View testID="mp-connect-unlink-error">
            <ErrorBanner message={unlinkError} />
          </View>
        ) : null}
        {content}
      </ScrollView>
      )}

      <CardOptionsSheet
        card={selectedCard}
        visible={overlay === "options"}
        settingDefault={setDefault.isPending}
        onMakeDefault={() => selectedCard && setDefault.mutate(selectedCard.id)}
        onRename={() => goFromOptions("rename")}
        onDelete={() => goFromOptions("delete")}
        onClose={() => setOverlay(null)}
        onClosed={() => {
          const next = nextOverlayRef.current;
          nextOverlayRef.current = null;
          if (next) setOverlay(next);
        }}
      />
      <RenameCardSheet
        card={selectedCard}
        visible={overlay === "rename"}
        isPending={rename.isPending}
        error={renameError}
        onSave={handleRename}
        onClose={() => setOverlay(null)}
      />
      <DeleteCardSheet
        card={selectedCard}
        cards={cardsQuery.data ?? []}
        visible={overlay === "delete"}
        isPending={removeCard.isPending}
        error={cardError}
        inUse={cardInUse}
        onConfirm={() => selectedCard && removeCard.mutate(selectedCard)}
        onClose={() => setOverlay(null)}
        onClosed={() => {
          // El error ya se vio dentro de la hoja: al cerrarla no queda también arriba de la lista.
          setCardError(null);
          setCardInUse(false);
        }}
      />

      <MpAccountSheet
        data={data ?? null}
        visible={mpOverlay === "account"}
        onLink={() => goFromMpAccount(data?.status === "linked" ? "change" : "link")}
        onUnlink={() => goFromMpAccount("unlink")}
        onClose={() => setMpOverlay(null)}
        onClosed={() => {
          const next = nextMpActionRef.current;
          nextMpActionRef.current = null;
          if (next === "unlink") setMpOverlay("unlink");
          else if (next === "change") setMpOverlay("change");
          else if (next === "link") void handleLink();
        }}
      />
      <ChangeMpAccountSheet
        visible={mpOverlay === "change"}
        onConfirm={() => {
          nextMpActionRef.current = "link";
          setMpOverlay(null);
        }}
        onClose={() => setMpOverlay(null)}
        onClosed={() => {
          // iOS no abre el navegador del OAuth mientras la hoja se está cerrando.
          if (nextMpActionRef.current !== "link") return;
          nextMpActionRef.current = null;
          void handleLink();
        }}
      />
      <UnlinkMpSheet
        visible={mpOverlay === "unlink"}
        isPending={unlink.isPending}
        onConfirm={() => unlink.mutate()}
        onClose={() => setMpOverlay(null)}
      />
      {toast ? <PaymentsToast key={toast} message={toast} onHide={hideToast} /> : null}
    </SafeAreaView>
  );
}
