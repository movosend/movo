import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  PanResponder,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useColorScheme } from "nativewind";
import {
  ArrowLeft,
  MapPinOff,
  PackageCheck,
  RefreshCw,
  Route as RouteIcon,
  Sparkles,
  X,
} from "lucide-react-native";
import type { CarrierRoute, CarrierRouteStop } from "@movo/shared/dist/types/routing";
import { useOptimizedRoute } from "../../../src/hooks/use-optimized-route";
import { RouteMap } from "../../../components/route/route-map";
import { StopList } from "../../../components/route/stop-list";
import { useThemeColors } from "../../../src/hooks/use-theme-colors";
import { decodePolyline } from "../../../src/lib/polyline";

// Punto de partida declarado del transportista (Claude Design originPin en calle Blas Pascal / Las Mulitas, Córdoba)
const DEMO_ORIGIN = { lat: -31.3533, lng: -64.2562 };

// Posición actual en movimiento en ruta entre origen y parada 1 (Claude Design courierDot)
const DEMO_CARRIER_LOCATION = { lat: -31.3850, lng: -64.2250 }; // Autovía / RN 9

const SCREEN_HEIGHT = Dimensions.get("window").height;

/** Polilínea codificada real del trazado vial Córdoba → Las Mulitas → Oncativo → Villa María (RN 9 / Autopista) */
const DEMO_POLYLINE =
  "rvw~DlzwfK@?B?H@H@H@JAZG^ODAfDkADOJa@BQpAcGdF|AQz@ETy@tDuApGmA`GuAsAyAcBSE[OWC_@A_BAMBSDSEQCAAiAQy@Ge@?]@a@D_@D[DA?I@MDA?wGzAE?QDgGhAoBf@eCy@m@Q_AYC?gBi@CAkBi@[IsBm@MEmEkAaFmAaGaBw@Us@Si@QUIGAKCUEk@OMCyCi@WEm@CM?MA[C_ESoBOI^i@nBMd@St@a@lAe@tAc@bAw@~A_AdBQXs@|@ON}@z@eA~@aBhAiBhAs@`@SJgA`@iA\\m@Lo@Pi@Lk@Jg@Ha@DwAHuABo@?c@?{@EaAEWC_@Gi@Gc@GKL{BrAsDrBoDnBkDpBeAj@mBhAoDrBoDpBw@d@uBjAmDpBqDrBoDrBwAv@yAz@uAv@yAz@wAx@uAx@{Av@yAx@uAx@wAv@uAx@wAz@oDpBqDrB}A~@G@E?CAKEu@bAiCjDy@rAGJCJUnAe@jCc@bCa@~Bc@|BETa@`CABMr@ShAe@fCMx@Ml@I^_BbHGXGRABa@bBq@vCWhA[pAa@`B_@|A_@zAUdAu@dDEP]zAc@lBc@hBa@hBkAhFAT?Nx@vHr@bHDb@DZh@vEjBdM@FDFwCfCyApAmBzAOLwCbCKJ[Rg@`@a@ZcBtA{GnFk@d@aDfCWR]Ry@f@q@^KFaAl@}CfBaFxCID]RmBhAULYPq@`@GDa@T_@RMF{@^iBv@iAd@MFGBg@TsAj@IDuB~@i@VYNMFWNULOJOJKHOLOLQPSRUTWZuDfE]`@]^[^]^s@x@YZW\\UT{@|@SRoAtAqBxBIJSV[ZiAjAoAtAy@|@w@z@{BdC_AdAs@v@YZSTURSRa@\\MJSPIFQHq@\\]R[N[Pc@TcAh@S`@@HBFbAhAd@h@HJrCpDKJe@j@s@z@]b@W\\W^Y`@QZQ\\GHHHDBFDjA\\vAd@hAZzIjCcBhIgDhQhC~AbE{Il@sA|@kBFOBQD_@R}B\\wDXsDBOBKb@mBr@mCz@wCfBsGf@iBz@{C`BmGNo@RmAh@cDvAiIxAcJBQIUCIM]CGAC?EAC?C?C?C@C?C@C@C@C@CPSTULQDCFEFEDGBEDKDIBI?G?I?IAKCICIGGEGIEECKEG?G?I?G@GBA?WMGEGEGIEGGGOOc@]m@e@[W_@_@WWY[OQQUQUSW[g@mCeFu@yAc@w@Yk@MW[m@[w@Y{@Ma@M_@e@aAQy@S}@Ou@O}@OeAIq@Io@IiAM}AGy@Eo@Co@Cs@Co@Am@As@?s@?o@BgA@y@DiAFcAHoANaCFs@JeBXsDDs@LyAN}BNwBLcB|@yMFeAHcANuBNwBRsCNaCL_BHmAHkAFkAFgAFkADmADmAD}@@_ADaB@s@?q@@oA@eB?gBAmAAkAEoBCwAEmACoAGkAEiAEw@Em@Es@G{@SkCMaBOgBOaBMeBOeBI{@?CI}@Ei@S}BGs@Gy@I{@Gs@KkAIs@KeAIq@MkAKeAGq@Gq@Es@Es@Eq@Aq@Co@?q@?s@?s@@o@BiABs@Dq@Do@Fq@Fo@Hq@NiAJo@Jo@Jo@Lo@Jo@RiAReAVaB^yB\\yB^yB`@_C`@cCv@wEV_BXcBTqANaATuATwAl@sDf@cD\\uBT_Bh@gE^_DNuAP}AZgDPgB^sDJsA@CLyARiB^eE`AeKXuCnBuSv@iIv@kIx@uIx@yId@}Eh@wFp@iHp@gHdAcLvAkO\\oD\\oDXkDRoBJeA@GPkBLmAJmAL_BHw@LkBLmBHmAL{BJcBH{AJiBZcFRoDRmDL{BHkADq@Dq@Fq@Ho@Fs@Jq@Hm@Lq@Jm@Lo@Lm@No@Pm@Nm@Po@Rk@Rk@Rm@Ti@Tk@Ti@Vi@Vi@Zi@Vg@Zg@Xe@Ze@\\e@\\e@\\c@^c@\\a@^_@`@c@^_@`@_@b@]`@]b@]d@[r@e@v@e@v@c@x@a@z@_@x@[|@[|@Yz@U|@S~@S|@O`AM~@Ij@E|@G`AE`AC~@G`ACjBIvAGrAEbBGtAGjAGtAEtAGrAG`AE~@E`AErAGbAErAGl@CrAE`AE`CKrAEbAEz@ElBGtAG~@El@C`AE|@G|@E`AE~@E`ACj@Ah@Ah@@l@?~@Bn@@|@B~@D~@D~@F~@Fl@Fl@Fd@Fh@Fj@Hj@Fj@JdARjARnARbAN|@J|@Jl@F|@Hl@Dj@Df@Bh@Bh@Bj@Bl@@j@@f@@h@?l@Aj@Aj@Af@Ah@Cl@CfAGF?l@Ej@C~@Il@Ej@Ez@Kj@Gh@Il@Kz@Oj@Kz@Qj@Kj@Oz@Sh@O|@Wf@Oz@Yz@[lAc@j@Uf@Sd@Uz@a@x@_@d@Wd@Wd@Yv@e@x@e@d@[r@e@d@]v@k@hCmBbAs@bAu@x@m@fAy@fAu@xAgAfAw@t@i@t@i@t@k@`@[b@]p@k@d@a@^]p@m@p@o@p@q@n@q@^_@^c@^c@l@q@n@w@\\c@\\c@\\e@h@u@l@{@f@w@f@w@x@oAj@y@h@y@t@kAv@kAx@w@`@o@l@{@LQRYRWTUXWVUVQ\\SVOXOZM\\MZIVIZGXGVEXC\\C\\C^AzAEd@?`@A`@A`@CVCVCREPERIRKRKRORSNQLSPWJYJ]H[F[Fa@B_@B_@@g@?w@?g@?[AYA[ASAWKkAKeAIw@OsAG{@Go@Gq@Es@Ew@GaACo@Cm@Ck@Ao@CkAC_A?{@A}@?}@?}@B_B@{@By@BaABqAFqAHgBRmCTuBRqBNgAZuBL{@Ha@\\kBh@cCd@kBj@wBh@eBv@aCt@gBl@yApAgCfAiBz@uAhA_Bv@aAHKv@{@|@eAjc@qd@rb@uc@bd@me@dBgBdDkDf|A}~AhoCmsC|@aAJMd_@e`@|qDiwDtWkXzm@mo@nMaN`CgCbMkMvPoQ~A{A`EmEjE_Ft@w@hAqAr@s@t@u@pBqBlDcDpG}GvkBkoBpDyDfFmFnZs[bwAozApBqBlCsC|AaBp@u@^a@\\c@V[X_@v@iAr@cAtB{Cv_BmoCb@q@Zc@Xa@\\c@V[Za@X]Z]X]Z]\\]\\_@\\_@d@g@t@u@^]^[zOqM|OwM`lB}}A~c@u_@lsBmhBdEmDpEwDd@_@b@_@d@[\\W`@WHGVOl@_@tAu@hmAom@jFoC`I}Dj@W~M_H`@SvBeAvFyCbDgBlDeB~H{DfGwCfBcAlLsFpN{I~fB{yAtGkGtFiGdJeLvRgWfDeErBaCfDwD`CaCrEoEdFqEjr@kk@zaAky@ld@}_@|@s@vJcIdTsQbCiB`CeBpBuAxBwAfC_BfC}AvBkAlBaAzGyDfDoBxCuBlBqArG{EbFaEt[_XrIeH`EqDrDoDpBoBvB_ClBwBlB{BnMiOpEuEvEkE|h@{c@`bByuA`b@y]tGkGtF{FrC}Bl@c@RKTIN?L?NDFDFDHHFJHHJFJ@z@URENAL@ZHRNnAtBRNT@h@Uta@fu@tpAn_CfB~C`AnBFNrAiAx@k@tDcDro@qi@j]kY^a@R[P[~D{Id@cAT]T_@NQd@a@jIaH`Aw@nBaBrEyDr@m@lB_BpKmJl@c@^Ud@UxAo@tMuEr@Y^Qh@]vGsFb\\cXt\\aYt]yYp[{Wd`@g\\bYyUny@er@xy@kr@|TcRbDoCrAgAfJ{HT[Xe@\\u@N]N[^}@^u@DIBC@CLQJOLKJKz@s@tDaDB?LMpHiGdDqCzDcDbEgD|AwAFEZYr@k@ZWjAaA_B{Cs@sAtAiArAiAr@pAxAhCHNFGzAqAzDcD~DgD|DeDdDsCnDuCfAaAl@]~@]vDwARGt@WVK`@Ud@a@j@e@n@i@lB_B|IsHvAkA|@u@xCgCr@m@~@w@n@g@jA}@rFwELKfLqJn`@k\\ny@ir@fp@gj@zHsG`y@yq@bP_Nnh@kc@fWgTf|AupAhk@_f@pMwKzRgP~e@ka@pp@kj@tq@ik@`CoBRQrAuALMnAmAt@y@z@gAPSRSLKTKJCLCRAPELKJOFQ@SAUGSKOMKQESCOCMCMIMKaAaAgA_BoAqBoAuBcAcBg@aAsF}JuJkQ_JiP}JyQsIuOkE_IoA{BKUKUO[K[K]K[G_@Kg@Gg@Gk@Cm@?u@?i@Dq@B[Fc@Fa@Lc@J_@L_@N]JWNWJUNSPUPUNQJK`A{@fa@y\\lK{IhB{Ab@[VSZWZ[\\]Z[HGFEHGNGLCJ?F?JAHEHIDKBM?MAKCGCGGGQUOUOUgAiBoBoDab@}u@k@cAyCkFGUGUCQ?K?S@M@IBMDQtAsDXo@Zo@z@uAf@o@h@k@Z]b@a@l@i@rf@a_@`b@m[fTkPt^sXrMkKvLuL`C{BbCwBpLsJrDoCpBuAnHuEbSmLlJsGnJaHhUgQpIyGdzA_oA`H{FhhEapDbUyRp@m@lM}KFGj~@ow@nb@_^FEbLeJdJ}HtRwOxeB}xAl~@aw@p@k@`g@sa@dk@of@dDoCrCcCzCiCpC_C`DmCfEoDp@i@jAcAb@_@bBkAnAqAxBkBbA{@bHaGpa@k]xHuGlu@_o@fDqCbBwAlA_AdDcCvAcA`CaBx@k@jBkAlBiAfOyIhAo@vA{@rA{@fCcBt@g@z@m@lDgC|CcC`BqAn[cXzpB_cBnPqNnl@ag@z`@y\\l{@kt@pEgE~B}BxAwAbCgCzAaBdAkAdJwKjCaDlb@qg@hD_EjAsAjAmA~@cAvA{AfBeBtAsAtCiCrHeGtIaH|ScQpHaGzKgJfmAkbAdRwOFGpd@k_@pxAglAhHaGXUrJwHdc@o^fIwGnEwDpHsG~DsDrLmL~CeD`HqH~DuE`F_GxDyEzCwDzBmChFoGxBqBxB{B|CaDpA}AFEDEDCFCHCT?VBLDJBPBN@J?JAHAHCHEHEHGDEDEDGBCBGHOTUJINILCPCNAV@XFRBP@Z?T?VATAXE^Mb@MzBqAtBmAzA}@hAq@|@g@b@Ub@W`@Qp@W^Od@SJGHGPKLGNAPAT@F@^B`@@b@Aj@?\\@^@\\@N@NB\\F\\F\\F\\F^F\\F\\Fb@Hf@Hj@Jp@Lv@LtCf@~AX|AXp@Lt@LjCd@tOlCH@hEv@TDrB\\x@Nz@NxB`@RBXFdAPbBXRDpB^D?tCh@~@NfDl@pGhAdPrCrB\\F@\\HRBzAVjATz@Pt@PNBhCd@t@Lb@HHBnCl@RDHBLDLFLJHDXTd@\\JHLHVJn@NLFLFHFFFDHHJ@F@@@DDDDBDBFBD?F?F?DCDCDCDE@CFCFCHCJAF?H@F?F@lB\\jGfAfEt@~AXzAV`BX`F|@bDj@dDh@HBF?hEv@HBF@b@HH@H@|HrAJ@@@H@PDFB@D@D@BBB@BB@B@D@B?B?DABABABC@A@EBC?ELS\\YHEJAzAoAdA}@xDcDzDeDzDgD|DgDrCdFxDgDiBeD";

const DEMO_ROUTE: CarrierRoute = {
  totalDistanceKm: 146.5,
  totalDurationMinutes: 115,
  optimized: true,
  disclaimer: null,
  stops: [
    {
      stopOrder: 1,
      shipmentId: "demo-shipment-thames",
      type: "pickup",
      address: "Thames 1450, Córdoba",
      lat: -31.4160,
      lng: -64.1890,
      estimatedArrivalMinutes: 20,
      estimatedArrivalAt: new Date(Date.now() + 20 * 60000).toISOString(),
      outsideTimeWindow: false,
      timeWindowStart: new Date(Date.now() + 15 * 60000).toISOString(),
      timeWindowEnd: new Date(Date.now() + 180 * 60000).toISOString(),
    },
    {
      stopOrder: 2,
      shipmentId: "demo-shipment-mulitas",
      type: "delivery",
      address: "San Martín 450, Oncativo",
      lat: -31.9140,
      lng: -63.6820,
      estimatedArrivalMinutes: 80,
      estimatedArrivalAt: new Date(Date.now() + 80 * 60000).toISOString(),
      outsideTimeWindow: false,
      timeWindowStart: new Date(Date.now() + 60 * 60000).toISOString(),
      timeWindowEnd: new Date(Date.now() + 300 * 60000).toISOString(),
    },
    {
      stopOrder: 3,
      shipmentId: "demo-shipment-villamaria",
      type: "delivery",
      address: "Av. Hipólito Yrigoyen 200, Villa María",
      lat: -32.4075,
      lng: -63.2403,
      estimatedArrivalMinutes: 135,
      estimatedArrivalAt: new Date(Date.now() + 135 * 60000).toISOString(),
      outsideTimeWindow: false,
      timeWindowStart: new Date(Date.now() + 120 * 60000).toISOString(),
      timeWindowEnd: new Date(Date.now() + 360 * 60000).toISOString(),
    },
  ],
};

/**
 * Pantalla principal de Ruta Optimizada del Transportista (MOVO-207).
 *
 * AC2: Muestra el mapa con paradas numeradas según el orden de recorrido VRPTW.
 * AC4: Vista de lista sincronizada con el mapa.
 * AC6: Soporte para ruta no optimizada / degradada si el solver de ruteo falla.
 * AC7: Recálculo automático al volver a la pantalla tras completar una parada.
 * AC8: Estado informativo si el GPS no tiene permiso o está inactivo (sin coordenadas inventadas).
 * AC9: Navegación al detalle del envío correspondiente.
 * AC10: Estado vacío con copy explicativo cuando no hay paradas asignadas.
 */
export default function OptimizedRouteScreen() {
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const topInset = insets?.top ?? 48;
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  // Alturas dinámicas para el bottom sheet fluido
  const EXPANDED_HEIGHT = Math.round(SCREEN_HEIGHT - (topInset + 64));
  const COLLAPSED_HEIGHT = Math.max(Math.round(SCREEN_HEIGHT * 0.32), 260);

  const { tripId } = useLocalSearchParams<{ tripId?: string }>();
  const [demoMode, setDemoMode] = useState(false);
  const {
    route,
    carrierLocation,
    isLoading,
    isRefreshing,
    gpsPermissionDenied,
    error,
    refetch,
  } = useOptimizedRoute(tripId);

  const displayRoute = demoMode ? DEMO_ROUTE : route;
  const displayLocation = demoMode ? DEMO_CARRIER_LOCATION : carrierLocation;

  const [selectedStopOrder, setSelectedStopOrder] = useState<number | null>(1);
  const [focusTrigger, setFocusTrigger] = useState<number>(0);
  const [isListExpanded, setIsListExpanded] = useState(false);

  // Animación continua y control por arrastre (PanResponder) del Bottom Sheet
  const sheetHeightAnim = useRef(new Animated.Value(COLLAPSED_HEIGHT)).current;
  const isExpandedRef = useRef(isListExpanded);
  isExpandedRef.current = isListExpanded;
  const currentHeightRef = useRef(COLLAPSED_HEIGHT);
  const dragStartHeightRef = useRef(COLLAPSED_HEIGHT);

  useEffect(() => {
    const id = sheetHeightAnim.addListener(({ value }) => {
      currentHeightRef.current = value;
    });
    return () => {
      sheetHeightAnim.removeListener(id);
    };
  }, [sheetHeightAnim]);

  const animateTo = useCallback(
    (toHeight: number, expandState: boolean) => {
      setIsListExpanded(expandState);
      try {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}
      Animated.spring(sheetHeightAnim, {
        toValue: toHeight,
        tension: 65,
        friction: 11,
        useNativeDriver: false,
      }).start();
    },
    [sheetHeightAnim]
  );

  const handleToggleExpand = useCallback(() => {
    const nextState = !isExpandedRef.current;
    animateTo(nextState ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT, nextState);
  }, [EXPANDED_HEIGHT, COLLAPSED_HEIGHT, animateTo]);

  // Gestos de arrastre desde el borde superior / handle del Bottom Sheet
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onStartShouldSetPanResponderCapture: () => false,
        onMoveShouldSetPanResponder: (_, gestureState) => {
          return Math.abs(gestureState.dy) > 3;
        },
        onMoveShouldSetPanResponderCapture: (_, gestureState) => {
          return Math.abs(gestureState.dy) > 3;
        },
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          sheetHeightAnim.stopAnimation();
          dragStartHeightRef.current = currentHeightRef.current;
        },
        onPanResponderMove: (_, gestureState) => {
          // Arrastrar hacia arriba (dy < 0) agranda la altura del sheet
          const newHeight = dragStartHeightRef.current - gestureState.dy;
          const clamped = Math.min(Math.max(newHeight, COLLAPSED_HEIGHT - 30), EXPANDED_HEIGHT + 30);
          sheetHeightAnim.setValue(clamped);
        },
        onPanResponderRelease: (_, gestureState) => {
          const movedUp = gestureState.dy < -25 || gestureState.vy < -0.25;
          const movedDown = gestureState.dy > 25 || gestureState.vy > 0.25;

          let shouldExpand = isExpandedRef.current;
          if (!isExpandedRef.current && movedUp) {
            shouldExpand = true;
          } else if (isExpandedRef.current && movedDown) {
            shouldExpand = false;
          } else {
            const midpoint = (COLLAPSED_HEIGHT + EXPANDED_HEIGHT) / 2;
            shouldExpand = currentHeightRef.current > midpoint;
          }

          animateTo(shouldExpand ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT, shouldExpand);
        },
        onPanResponderTerminate: () => {
          animateTo(isExpandedRef.current ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT, isExpandedRef.current);
        },
      }),
    [COLLAPSED_HEIGHT, EXPANDED_HEIGHT, animateTo, sheetHeightAnim]
  );

  // Determinar si hay un viaje activo válido con paradas asignadas
  const hasActiveTrip =
    displayRoute != null &&
    displayRoute.stops.length > 0 &&
    (demoMode || (!isLoading && !gpsPermissionDenied && !error));

  // Parada activa que corresponde ejecutar según orden estricto
  const activeStop = displayRoute?.stops[0] ?? null;

  const demoPolylineCoordinates = useMemo(
    () => (demoMode ? decodePolyline(DEMO_POLYLINE) : undefined),
    [demoMode]
  );

  const handleSelectStop = (stop: CarrierRouteStop) => {
    setSelectedStopOrder(stop.stopOrder);
    setFocusTrigger(Date.now());
  };

  const handleResetFocus = () => {
    // El mapa anima suavemente de regreso a la vista panorámica completa
  };

  const handlePressShipment = (shipmentId: string) => {
    if (shipmentId.startsWith("demo-")) {
      return;
    }
    router.push(`/shipments/${shipmentId}`);
  };

  const handleStartDemo = () => {
    setSelectedStopOrder(1);
    setDemoMode(true);
  };

  return (
    <View className="flex-1 bg-bg">
      {/* 1. VISTA CUANDO HAY UN VIAJE ACTIVO CON MAPA */}
      {hasActiveTrip && displayRoute ? (
        <View className="flex-1 relative">
          {/* Isla Flotante Superior (Claude Design lines 147-156) */}
          <View
            testID="route-floating-island"
            style={{
              position: "absolute",
              top: topInset + 8,
              left: 16,
              right: 16,
              zIndex: 25,
              minHeight: 52,
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 14,
              backgroundColor: isDark ? "rgba(17, 17, 19, 0.94)" : "rgba(255, 255, 255, 0.94)",
              borderWidth: 1,
              borderColor: isDark ? "rgba(255, 255, 255, 0.12)" : "rgba(10, 10, 11, 0.08)",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 8 },
              shadowOpacity: 0.15,
              shadowRadius: 20,
              elevation: 6,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            <View className="h-2 w-2 rounded-full bg-lime-500 flex-none" />
            <View className="flex-1 min-w-0 justify-center">
              <Text className="font-sans-bold text-[10px] tracking-wider uppercase text-fg-3">
                {demoMode ? "Modo Demo" : "Viaje en curso"}
              </Text>
              <Text
                numberOfLines={1}
                className="font-sans-medium text-[13px] text-fg"
              >
                Parada {activeStop?.stopOrder ?? 1} de {displayRoute.stops.length} ·{" "}
                {activeStop?.address ?? "Inicio"}
              </Text>
            </View>
            {demoMode ? (
              <Pressable
                testID="route-exit-demo-button"
                onPress={() => setDemoMode(false)}
                className="h-8 px-3 rounded-full border border-border bg-bg items-center justify-center flex-none"
                accessibilityRole="button"
                accessibilityLabel="Salir demo"
              >
                <Text className="font-sans-medium text-[12px] text-fg">Salir demo</Text>
              </Pressable>
            ) : (
              <Pressable
                testID="route-back-button"
                onPress={() => router.back()}
                className="h-8 px-3 rounded-full border border-border bg-bg items-center justify-center flex-none"
                accessibilityRole="button"
                accessibilityLabel="Inicio"
              >
                <Text className="font-sans-medium text-[12px] text-fg">Inicio</Text>
              </Pressable>
            )}
          </View>

          {/* Fondo completo: Mapa interactivo que no se redimensiona para evitar parpadeos nativos */}
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
            }}
            className="bg-bg-mute overflow-hidden"
          >
            <RouteMap
              carrierLocation={displayLocation}
              originLocation={demoMode ? DEMO_ORIGIN : null}
              stops={displayRoute.stops}
              selectedStopOrder={selectedStopOrder}
              activeStopOrder={activeStop?.stopOrder ?? 1}
              onSelectStop={handleSelectStop}
              polylineCoordinates={demoPolylineCoordinates}
              onResetFocus={handleResetFocus}
              focusTrigger={focusTrigger}
              topOffset={topInset + 70}
              bottomOffset={COLLAPSED_HEIGHT}
              showControls={!isListExpanded}
            />
          </View>

          {/* Bottom sheet fluido deslizable desde el borde superior */}
          <Animated.View
            testID="route-bottom-sheet"
            style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              height: sheetHeightAnim,
              zIndex: 30,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderTopWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.bg,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: -6 },
              shadowOpacity: 0.14,
              shadowRadius: 18,
              elevation: 12,
              overflow: "hidden",
            }}
          >
            <StopList
              route={displayRoute}
              selectedStopOrder={selectedStopOrder}
              activeStopOrder={activeStop?.stopOrder ?? 1}
              onSelectStop={handleSelectStop}
              onPressShipment={handlePressShipment}
              isExpanded={isListExpanded}
              onToggleExpand={handleToggleExpand}
              panHandlers={panResponder.panHandlers}
            />
          </Animated.View>
        </View>
      ) : (
        /* 2. VISTA CUANDO NO HAY VIAJE ACTIVO (Carga, Error, GPS Denegado o Sin Paradas): Header estándar sobrio */
        <>
          <SafeAreaView edges={["top"]} className="border-b border-border bg-bg-sub">
            <View className="flex-row items-center justify-between px-4 pb-3.5 pt-2">
              <View className="flex-row items-center gap-3">
                <Pressable
                  testID="route-back-button"
                  onPress={() => router.back()}
                  className="h-9 w-9 items-center justify-center rounded-full border border-border bg-bg"
                  accessibilityRole="button"
                  accessibilityLabel="Volver"
                >
                  <ArrowLeft size={18} color={colors.fg1} />
                </Pressable>
                <View>
                  <Text className="font-sans-semibold text-[16px] text-fg">
                    Mi ruta de hoy
                  </Text>
                  <Text className="font-sans text-[11.5px] text-fg-3">
                    Itinerario del día
                  </Text>
                </View>
              </View>

              <Pressable
                testID="route-refresh-button"
                onPress={() => void refetch()}
                disabled={isLoading || isRefreshing}
                className="h-9 w-9 items-center justify-center rounded-full border border-border bg-bg"
                accessibilityRole="button"
                accessibilityLabel="Actualizar ruta"
              >
                <RefreshCw
                  size={16}
                  color={colors.fg2}
                  className={isRefreshing ? "animate-spin" : undefined}
                />
              </Pressable>
            </View>
          </SafeAreaView>

          {/* Contenido según estado vacío o de carga */}
          {isLoading ? (
            <View testID="route-loading-state" className="flex-1 items-center justify-center gap-4 px-6">
              <ActivityIndicator size="large" color="#C6F24A" />
              <View className="items-center gap-1.5 text-center">
                <Text className="font-sans-semibold text-[17px] text-fg">
                  Calculando la mejor ruta...
                </Text>
                <Text className="font-sans text-[13px] text-fg-3 text-center">
                  Optimizamos tus paradas según distancias y ventanas horarias.
                </Text>
              </View>
            </View>
          ) : gpsPermissionDenied && !demoMode ? (
            /* AC8: Sin permiso de GPS */
            <View testID="route-gps-denied-state" className="flex-1 items-center justify-center gap-5 px-8">
              <View className="h-16 w-16 items-center justify-center rounded-full bg-bg-mute">
                <MapPinOff size={28} color={colors.fg3} />
              </View>
              <View className="items-center gap-2 text-center">
                <Text className="font-sans-semibold text-[18px] text-fg text-center">
                  Permiso de ubicación necesario
                </Text>
                <Text className="font-sans text-[13.5px] text-fg-3 text-center leading-5">
                  Para calcular el itinerario óptimo necesitamos conocer tu posición de partida. No calculamos rutas desde puntos ficticios.
                </Text>
              </View>
              <View className="w-full max-w-xs gap-2.5">
                <Pressable
                  testID="route-retry-gps-button"
                  onPress={() => void refetch()}
                  className="rounded-[12px] bg-fg py-3.5 items-center justify-center"
                >
                  <Text className="font-sans-semibold text-[14px] text-bg">
                    Permitir ubicación y reintentar
                  </Text>
                </Pressable>

                {__DEV__ && (
                  <Pressable
                    testID="route-demo-button-gps"
                    onPress={handleStartDemo}
                    className="flex-row items-center justify-center gap-2 rounded-[12px] border border-border bg-bg-sub px-5 py-3"
                  >
                    <Sparkles size={16} color="#2BB673" />
                    <Text className="font-sans-medium text-[13.5px] text-fg">
                      Ver recorrido de prueba (Demo)
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          ) : error && !demoMode ? (
            /* Error de backend o conexión */
            <View testID="route-error-state" className="flex-1 items-center justify-center gap-4 px-8">
              <View className="h-14 w-14 items-center justify-center rounded-full bg-danger-100">
                <RouteIcon size={26} color="#E5484D" />
              </View>
              <View className="items-center gap-1.5 text-center">
                <Text className="font-sans-semibold text-[17px] text-fg text-center">
                  No pudimos cargar tu ruta
                </Text>
                <Text className="font-sans text-[13px] text-fg-3 text-center">
                  {error}
                </Text>
              </View>
              <View className="items-center gap-2.5">
                <Pressable
                  testID="route-retry-error-button"
                  onPress={() => void refetch()}
                  className="rounded-[10px] border border-border bg-bg-sub px-5 py-2.5"
                >
                  <Text className="font-sans-medium text-[13.5px] text-fg">
                    Reintentar
                  </Text>
                </Pressable>

                {__DEV__ && (
                  <Pressable
                    testID="route-demo-button-error"
                    onPress={handleStartDemo}
                    className="flex-row items-center justify-center gap-2 rounded-[12px] border border-border bg-bg-sub px-5 py-2.5"
                  >
                    <Sparkles size={15} color="#2BB673" />
                    <Text className="font-sans-medium text-[13px] text-fg">
                      Ver recorrido de prueba (Demo)
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          ) : (
            /* AC10: Sin envíos activos / ruta vacía ("Sin paradas asignadas") */
            <View testID="route-empty-state" className="flex-1 items-center justify-center gap-5 px-8">
              <View className="h-16 w-16 items-center justify-center rounded-full bg-lime-500/15">
                <PackageCheck size={32} color="#2BB673" />
              </View>
              <View className="items-center gap-2 text-center">
                <Text className="font-sans-semibold text-[18px] text-fg text-center">
                  Sin paradas asignadas
                </Text>
                <Text className="font-sans text-[13.5px] text-fg-3 text-center leading-5">
                  No tenés envíos pendientes de retiro ni entrega para hoy. Cuando tengas viajes asignados, vas a poder seguir tu recorrido paso a paso.
                </Text>
              </View>
              <View className="w-full max-w-xs gap-2.5">
                <Pressable
                  testID="route-explore-shipments-button"
                  onPress={() => router.push("/(app)/(tabs)/transport")}
                  className="rounded-[12px] bg-fg px-6 py-3.5 items-center justify-center"
                >
                  <Text className="font-sans-semibold text-[14px] text-bg">
                    Explorar envíos disponibles
                  </Text>
                </Pressable>

                {__DEV__ && (
                  <Pressable
                    testID="route-demo-button"
                    onPress={handleStartDemo}
                    className="flex-row items-center justify-center gap-2 rounded-[12px] border border-border bg-bg-sub px-5 py-3"
                  >
                    <Sparkles size={16} color="#2BB673" />
                    <Text className="font-sans-medium text-[13.5px] text-fg">
                      Ver recorrido de prueba (Demo)
                    </Text>
                  </Pressable>
                )}
              </View>
            </View>
          )}
        </>
      )}
    </View>
  );
}
