import { Redirect } from "expo-router";

/**
 * Destino del deep link `movo://mp-connect` (MOVO-112). Normalmente lo consume
 * `openAuthSessionAsync` y nunca llega al router, pero en Android expo-router también
 * puede recibirlo y mostraría "Unmatched route". Lleva a "Pagos y cobros" en la pestaña de medios de pago y cobro (donde está el estado de
 * Mercado Pago que la persona acaba de vincular), que vuelve a
 * consultar el status al ganar foco. Los query params se ignoran a propósito: nunca se
 * confía en ellos (ver `mp-connect-flow.ts`).
 */
export default function MpConnectReturn() {
  return <Redirect href={"/profile/payments?tab=methods" as never} />;
}
