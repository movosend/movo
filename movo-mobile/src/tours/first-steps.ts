import { expandTabBar } from "../store/tab-bar-store";
import type { TourDefinition } from "./types";

/** La pill de la tab bar tarda ~280ms en volver a su tamaño (`floating-tab-bar.tsx`). */
const TAB_BAR_EXPAND_MS = 320;

/**
 * MOVO-169, Tour 1 "Primeros pasos" (emisor). Textos y orden del prototipo
 * (`prototipo-tutorial.dc.html`). El último paso depende de si ya puede transportar: si le
 * falta algo, lo lleva al checklist de requisitos; si no, le avisa que el Tour 2 lo espera
 * en Transportar.
 */
export const FIRST_STEPS_TOUR: TourDefinition = {
  id: "first_steps",
  version: 1,
  icon: "package",
  steps: [
    {
      id: "welcome",
      route: "/home",
      title: ({ firstName }) => (firstName ? `¡Ya estás adentro, ${firstName}!` : "¡Ya estás adentro!"),
      body: "Te mostramos en un minuto cómo usar Movo.",
    },
    {
      id: "send",
      route: "/home",
      anchorId: "home-send-cta",
      title: "Publicá un envío",
      body: "Contanos qué mandás, de dónde a dónde y quién lo recibe. Los transportistas que van para ese lado te mandan ofertas.",
    },
    {
      id: "recent",
      route: "/home",
      anchorId: "home-recent-activity",
      title: "Seguí tus envíos",
      body: "Acá vas a ver en qué estado está cada paquete y las ofertas que te lleguen.",
    },
    {
      id: "chat",
      route: "/home",
      anchorId: "home-chat-button",
      title: "Hablá con tu transportista",
      body: "Cuando aceptes una oferta, coordinan el retiro y la entrega por acá.",
    },
    {
      id: "transport-tab",
      route: "/home",
      anchorId: "tab-transport",
      title: "¿Ya hacés un recorrido seguido?",
      body: "También podés llevar paquetes de otros y cobrar por eso.",
      beforeShow: () => {
        expandTabBar();
        return TAB_BAR_EXPAND_MS;
      },
    },
    {
      id: "requirements",
      route: "/transport",
      anchorId: "carrier-requirements-card",
      when: ({ canBrowse }) => !canBrowse,
      title: "Esto te falta para transportar",
      body: "Verificá tu licencia y vinculá Mercado Pago. Cuando esté todo listo, te mostramos cómo funciona.",
    },
    {
      id: "ready",
      route: "/home",
      when: ({ canBrowse }) => canBrowse,
      title: "¡Ya podés transportar!",
      body: "Tenés todo listo. Cuando entres a Transportar te mostramos cómo funciona.",
    },
  ],
};
