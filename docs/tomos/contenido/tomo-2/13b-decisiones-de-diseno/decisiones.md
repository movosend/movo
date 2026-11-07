# Registro resumido de decisiones de diseño

Las decisiones de alcance local se resumen aquí para ubicar la regla y su efecto. El registro íntegro, con contexto, alternativas y referencias, se conserva en el anexo digital `docs/tomos/anexos/decisiones-diseno-completas.md`. Los ADR de arquitectura permanecen completos en Arquitectura del Sistema. Las DD-037, DD-050 y DD-056 se reproducen completas porque explican la asignación, la vigencia del pago y la resolución de disputas.

## DD-016 · Foto de perfil: prefijo profile-photos/ público en S3 con key aleatoria

**Decisión.** Bucket S3 con policy de lectura pública acotada al prefijo profile-photos/* y el resto privado, con key de objeto basada en un UUID aleatorio. photo_url queda como URL estable y cacheable por el cliente.

**Efecto o costo.** Trade-offs: Quien tenga la URL exacta ve la foto sin autenticarse; se acepta porque la foto ya es pública por diseño.

## DD-018 · Precio sugerido: implementación lineal provisoria versionada, antes del motor de precios real

**Decisión.** Se adopta el contrato POST /quote en movo-svc-pricing-logistics, tipado en shared/movo-shared/src/types/pricing.ts (QuoteRequest/QuoteResponse/PriceCalculationMethod) y consumido desde movo-svc-shipments vía src/adapters/pricing-client.ts.

**Efecto o costo.** Trade-offs: Positivo: cumple el AC completo de la US padre (MOVO-8), incluida la rama de "precio a estimar" para datos incompletos — no es un recorte de alcance silencioso.

## DD-021 · Set canónico de ShipmentStatus ampliado de 9 a 11 estados

**Decisión.** El enum pasa a 11 valores, en @movo/shared, en Postgres y en la máquina de estados, en el mismo PR. assigned_unfunded: transportista asignado sin hold creado porque el retiro es a más de N días; cuando el retiro entra en N días se abre una ventana para que el emisor confirme el pago con la app abierta (crea el hold y pasa a assigned), y sin pago a T-24h vuelve a published.

**Efecto o costo.** Trade-offs: Al momento de la decisión ninguna de las dos transiciones nuevas se disparaba todavía (bloqueadas por Mercado Pago, MOVO-210 y MOVO-212): la máquina de estados permitía un camino que ningún endpoint HTTP disparaba, documentado como "disponible y probado, no disparado" en vez de dejarlo implícito.

## DD-023 · Retención de la traza GPS del transportista

**Decisión.** Se adopta un plazo de 30 días desde que el envío cierra (estados delivered/completed/cancelled/rejected by receiver — POSITION_PURGE_ELIGIBLE_STATUSES en shipment-state-machine.ts), anclado en Shipment.lastStatusChangedAt (columna ya existente, mantenida por updateStatus() desde MOVO-104/105, sin necesidad de una columna nueva).

**Efecto o costo.** Trade-offs: Positivo — minimiza el tiempo que se retiene un dato de geolocalización sensible sin necesidad real, alineado al propósito declarado (evidencia operativa, no analítica).

## DD-026 · Bloqueo de usuarios: efecto simétrico sobre envíos y ofertas

**Decisión.** La relación de bloqueo vive en movo-svc-users (users.user_blocks, una fila por dirección) y su efecto es simétrico. movo-svc-users expone POST y DELETE /users/:id/block, GET /users/me/blocked (solo la lista propia, nunca quién bloqueó al usuario) y el endpoint interno GET /internal/users/:id/block-relations, que devuelve la unión de ambas direcciones.

**Efecto o costo.** Trade-offs: Positivo: el bloqueo protege efectivamente a quien bloquea: la otra persona deja de verla y no puede iniciar ninguna interacción nueva.

## DD-027 · rejected\_by\_receiver deja de ser terminal: el emisor elige otro receptor o cancela

**Decisión.** rejected_by_receiver deja de ser terminal (MOVO-253, reemplaza en ese punto a MOVO-79/DD-021): el emisor tiene un plazo (receiver_redesignation_deadline, 48hs con tope en la ventana de retiro) para elegir otro receptor (POST /shipments/:id/receiver, vuelve a awaiting_receiver_confirmation) o cancelar; si no, el barrido de MOVO-130 lo pasa a cancelled.

**Efecto o costo.** Trade-off aceptado: El terminal real de un rechazo pasa a ser cancelled (el rechazo queda como evento en la línea de tiempo); quien rechazó pierde acceso al envío apenas se elige a otra persona (el acceso sigue a receiverId); solo se cambia la persona, nunca la dirección de entrega, así el precio sugerido sigue sin recalcularse (MOVO-82 AC8)

## DD-028 · Precio comprometido: cotización congelada de 15 minutos con quoteId

**Decisión.** POST /shipments/quote cotiza con la misma función que la creación y, si hay precio, lo guarda en Redis (shipment_quote:{quoteId}, TTL de 15 minutos, constante y no variable de entorno) ligado al usuario y a un fingerprint de los datos que afectan el precio (SHA-256 de tipo, peso, dimensiones y coordenadas redondeadas a 6 decimales).

**Efecto o costo.** Trade-offs: El emisor que tarda más de 15 minutos o cambia datos que afectan el precio tiene que volver a confirmar uno nuevo.

## DD-029 · Separación de los estados expired y cancelled en viajes

**Decisión.** Separación de estado expired y cancelled en viajes (MOVO-260): se introduce TripStatus.EXPIRED para viajes vencidos por el cronjob trip-expiry-sweep.ts, diferenciándolos de TripStatus.CANCELLED que ahora se usa para la cancelación lógica explícita del transportista (POST /trips/:id/cancel).

**Efecto o costo.** Trade-off aceptado: Desacoplamiento semántico que permite a la UI diferenciar un viaje vencido por inactividad de uno cancelado manualmente; mantiene historial completo de la actividad del transportista, lo que sirve para trazabilidad y métricas

## DD-030 · Juegos del sitio institucional: prefijo /demo autenticado con API key

**Decisión.** Juegos del sitio institucional (movo-institucional /juegos, primero el juego de precios de la feria): el gateway autentica el prefijo /demo con API key (DEMO_API_KEYS, header x-api-key) en vez de JWT, solo desde el servidor de Next (sin CORS); POST /quote de pricing acepta includeBreakdown opt-in, que solo pide el módulo demo de svc-shipments (el emisor sigue sin desglose, ADR-021 intacto); partidas en shipments.pricing_game_sessions

**Efecto o costo.** Trade-off aceptado: Primer cliente sin usuario: una key filtrada permite cotizar (Google Routes, pago) y escribir partidas hasta rotarla, mitigado con rate limit por visitante y keys por cliente; el desglose de la fórmula queda visible en el juego (es justamente lo que se quiere mostrar en la feria)

## DD-031 · Juego del optimizador de la feria contra OR-Tools real

**Decisión.** Juego del optimizador de la feria (movo-institucional /juegos/optimizador): compite contra el OR-Tools real de POST /optimize/route, con dos opt-in que solo usa el módulo demo de svc-shipments (objective: "distance" y matrix precalculada); la matriz de cada ciudad (pool fijo) se pide una vez a POST /routes/matrix y se cachea 30 días en Redis, así la feria completa factura \~487 elementos de Google en vez de \~49 por partida.

**Efecto o costo.** Trade-off aceptado: La matriz cacheada no refleja cambios de tránsito durante el evento (irrelevante para comparar órdenes); el ranking muestra nombres que el visitante elige en un stand público, y quien tenga la key demo puede reiniciarlo (mismo riesgo que DD-030)

## DD-032 · Expiración y cierre automático de envíos y viajes

**Decisión.** Expiración y cierre automático (MOVO-258, revisa “bloquea, no cascadea” de MOVO-238): todo envío con transportista (assignment_pending/assigned_unfunded/assigned) se cancela sin culpables 24h después de cerrar su ventana de retiro efectiva (la acordada, copiada al envío al aceptar la oferta); cancelar un envío cierra sus ofertas (pending vigentes y accepted → nuevo OfferStatus.shipment_cancelled) en la misma transacción y eso destraba al viaje sin cascada explícita; un published sigue vivo mientras tenga ofertas vigentes (solo lo protege de la cancelación: deja de ofrecerse y no recibe ofertas nuevas); un in_transit que no se entrega se MARCA para revisión (entrega estimada + 50% de la duración) y nunca se cancela; los paquetes de un viaje quedan fijos al iniciarlo (start() exige ≥1 paquete; solo un viaje declared recibe ofertas, matches y el push de paquete compatible) y un viaje active pasa a completed cuando todos sus paquetes terminaron (disputed cuenta como terminado: sin salida modelada, retenerlo trabaría al transportista para siempre), o se cancela si se queda sin ninguno

**Efecto o costo.** Trade-off aceptado: Sin penalización ni atribución de responsabilidad (quién faltó queda para un ticket aparte con geolocalización); delivered→completed y la reversión por hold fallido siguen dependiendo de Mercado Pago (MOVO-210/212); el in_transit anómalo solo avisa al transportista y deja la marca, sin disputa automática ni alerta de admin todavía; el conteo de oferta de transportistas del pricing (ADR-021) sigue contando viajes active pese a que ya no toman paquetes, pendiente en MOVO-270

## DD-033 · Navegación turn-by-turn del transportista por deep-link

**Decisión.** Navegación turn-by-turn del transportista (MOVO-237): se delega por deep-link a la app de mapas del dispositivo (Google Maps nativo → Waze → Google Maps web, movo-mobile/src/lib/navigation-deeplink.ts) en vez del Navigation SDK de Google o re-routing propio.

**Efecto o costo.** Trade-off aceptado: Costo cero para Movo a cambio de que la navegación salga de la app (el tracking en segundo plano de MOVO-242 sigue emitiendo, pero el transportista tiene que volver a Movo para confirmar cada parada); el Navigation SDK (\~US\$25/1.000, 5x Compute Routes) queda descartado hasta que haya una razón de producto para pagarlo.

## DD-034 · Inicio de viaje: día calendario y paquete ejecutable

**Decisión.** Inicio de viaje (MOVO-277, complementa DD-032 sin modificarlo): POST /trips/:id/start exige que el día calendario argentino de departureAt ya haya llegado (canStartTripOn, @movo/shared, la misma función que decide el botón en el mobile) y al menos un paquete ejecutable. “Paquete ejecutable” (TRIP_EXECUTABLE_SHIPMENT_STATUSES \= assigned/in_transit, shipment-state-machine.ts) pasa a ser la única definición que usan start(), la ruta del viaje, el tracking y el conteo executablePackagesCount de /trips; “paquete aceptado” (ACCEPTED_OFFER_FILTER) sigue rigiendo lo que bloquea editar/cancelar y el cierre de un viaje active

**Efecto o costo.** Trade-off aceptado: Mientras no exista el hold de fondos (MOVO-210) ningún envío llega a assigned, así que ningún viaje se puede iniciar desde la app (en dev hay que forzar el estado); a cambio, un viaje ya no queda active semanas antes ni con “N paquetes” y “Sin paradas asignadas”, bloqueando al transportista por el índice de 1 viaje activo.

## DD-036 · Requisitos habilitantes del transportista: licencia aprobada \+ cuenta de Mercado Pago vinculada

**Decisión.** Para operar como transportista hacen falta tres cosas: KYC de identidad aprobado (prerequisito, igual que antes), licencia de conducir aprobada (kyc_status_license \= approved, svc-users) y una cuenta de Mercado Pago con la que hoy se pueda cobrar (svc-payments, mismo criterio que el hold: no desvinculada, no revocada, token sin vencer y con public_key).

**Efecto o costo.** Trade-offs: • Se pierde el transportista sin vehículo propio (el caso que MOVO-142 quería cubrir).

## DD-037 · Saga de asignación: ofertas vivas hasta confirmar el hold y reversión a published

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-210)</p>

<span class="dd-etq">Contexto</span>


**Situación:** MOVO-210 implementa la asignación: aceptar una oferta, pagar el hold de fondos del emisor en Mercado Pago (ADR-022) y recién entonces asignar. svc-shipments es dueño de la saga y única puerta del mobile; llama a los endpoints internos de holds de svc-payments. La ruta depende de cuándo es el retiro: a N días o menos va por assignment\_pending (el emisor paga al aceptar) y a más por assigned\_unfunded (ventana de confirmación, DD-021).

**Alcance:** Complementa ADR-022 y DD-021.

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Las demás ofertas no se cierran al aceptar sino al confirmarse el hold: pasan a superseded en la misma transacción que → assigned, con aviso a cada transportista. Así una asignación que se cae devuelve el envío a published con sus ofertas vivas (decisión del equipo en el review de la PR \#227). La oferta aceptada que no prospera pasa a assignment\_lapsed (valor nuevo de OfferStatus), no a rejected, porque no fue un rechazo del emisor. Volver a published desasigna de verdad: carrierId, precio y entrega estimada pasan a null y se restaura la ventana de retiro original. Se agrega la arista assigned → assigned\_unfunded (revierte "assigned nunca vuelve atrás" de DD-021, solo hacia ese estado) para que, si Mercado Pago pierde el hold ya confirmado, el emisor reconfirme el pago dentro de la ventana en vez de perder la asignación. updateStatus suma expectedFrom, expectedCarrierId y expectedAgreedPriceArs para cerrar las carreras entre pagar, cancelar y revertir. Un barrido (cada 5 minutos por defecto) expira los assignment\_pending impagos, avisa y recuerda en la ventana y revierte a T-24h del retiro; antes de revertir reconcilia con payments y no revierte a ciegas si payments no responde. La cancelación cancela primero y libera el hold después.

<span class="dd-etq">Consecuencias</span>


**Trade-offs:** Una oferta puede vencer (expiresAt) mientras espera el pago. Un hold perdido con el envío ya in\_transit no tiene estado al que volver: queda como error detectable (funding\_hold\_lost\_in\_transit) hasta que MOVO-212 y MOVO-268 definan la captura. Un assigned puede volver a pedir pago, relajando la garantía de DD-021. Si la liberación del hold falla al cancelar, el envío igual queda cancelado y el hold vence solo en Mercado Pago, con un error logueado.

<span class="dd-etq">Referencias</span>


**Referencias:** MOVO-12, MOVO-209 (holds en payments), MOVO-210 (este ticket), MOVO-212 (captura), MOVO-215 y DD-050 (plazo del hold), MOVO-258, DD-021, ADR-022.

## DD-038 · Transferencia de receptor como entidad paralela al ciclo de vida del envío

**Decisión.** Entidad propia, no un estado del envío. shipments.receiver_transfer_requests ( pending_new_receiver → completed , con rejected_by_new_receiver , expired y cancelled como cierres alternativos).

**Efecto o costo.** * Sin aprobación del emisor, una cuenta de receptor comprometida puede desviar el envío hacia otra persona verificada.

## DD-039 · Tarjetas guardadas del emisor con re-ingreso de CVV

**Decisión.** El emisor puede guardar tarjetas y, al pagar, solo re-ingresa el CVV. El CVV nunca se guarda: el mobile lo usa para pedir a MP un token de un solo uso (card_id + CVV + public_key correspondiente) y lo manda como hoy a POST /shipments/:id/funding.

**Efecto o costo.** Trade-offs: • Cumplimiento (PCI): no cambia.

## DD-041 · Pricing por peso facturable con distancia achatada

**Decisión.** Método nuevo package_tapered_v2 (PriceCalculationMethod, @movo/shared y Python).

**Efecto o costo.** Trade-offs: • El documento a larga distancia sigue siendo caro (\~\$15.500 a 1.500 km, más que 1 kg por Correo): su precio es casi todo distancia y una base menor no alcanza.

## DD-042 · Viajes recurrentes: recurrencia como atributo del Trip con generación de la siguiente ocurrencia

**Decisión.** Un trip por ocurrencia, generados de a uno.

**Efecto o costo.** Ver el registro completo para las consecuencias y alternativas.

## DD-043 · Refresh idempotente del panel en una ventana de 10 segundos

**Decisión.** Refresh idempotente del panel durante 10 s con la misma clave y el mismo token, coordinado en Redis y con resultado cifrado (MOVO-291).

**Efecto o costo.** Trade-off aceptado: Es una excepción acotada a la rotación estricta, pensada para solicitudes concurrentes de Next.

## DD-044 · Cuenta corriente del usuario

**Decisión.** Cuenta corriente por usuario (no por rol), en payments.user_ledger_entries, con saldo con signo (positivo \= debe, negativo \= a favor); el saldo es la suma de lo que no está voided.

**Efecto o costo.** Trade-off aceptado: La plata de las penalidades cobradas como deuda queda para Movo, sin crédito al emisor perjudicado.

## DD-045 · Salida para un envío in\_transit demorado: aviso, disputa automática y bloqueo del transportista

**Decisión.** La marca de anomalía de tránsito se expone (transitAnomalyFlaggedAt; “Demorado” en la app y “No tenemos la ubicación del transportista” en el mapa).

**Efecto o costo.** Trade-off aceptado: El transportista con una disputa abierta queda bloqueado sin salida hasta MOVO-34.

## DD-046 · Notificaciones push del chat con el texto y ráfagas en un resumen (MOVO-301)

**Decisión.** Las notificaciones push del chat llevan nombre, rol y texto (140 caracteres), al estilo WhatsApp; reemplaza el punto “push sin el texto” de ADR-023.

**Efecto o costo.** Trade-off aceptado: El texto se ve en la pantalla bloqueada.

## DD-047 · Penalidad por cancelar un envío asignado

**Decisión.** Si se cancela un envío assigned con menos de 12 h hasta el inicio de la ventana de retiro acordada y la ventana abierta, se cobra el 25 % del precio acordado; con 12 h o más, o con la ventana cerrada, es sin cargo.

**Efecto o costo.** Trade-off aceptado: Mercado Pago cobra el application_fee entero en la captura parcial (spike MOVO-305), por lo que el transportista recibe cerca del 11 % del precio y no el 25 %. Con el plan B (incluido un hold con deuda previa) o con el hold vencido, la penalidad se cobra después (MOVO-311) y no compensa al transportista.

## DD-048 · Cuenta cobradora de Movo configurada por credenciales

**Decisión.** “Pagar mi saldo” cobra con las credenciales de la propia cuenta de Mercado Pago de Movo S.A. (MP_COLLECTOR_ACCESS_TOKEN y las claves asociadas), sin un usuario interno de Movo ni OAuth en la app; reemplaza la cobradora vinculada a un usuario de MOVO-312.

**Efecto o costo.** Trade-off aceptado: En dev el token vence a los 180 días y se renueva a mano.

## DD-049 · Sanciones de cuenta: suspended y banned

**Decisión.** AccountStatus.suspended bloquea las operaciones pero no el login, y banned pasa a significar inhabilitada (corta el login).

**Efecto o costo.** Trade-off aceptado: Las marcas pueden quedar desfasadas hasta el próximo barrido (5 min por defecto) si Redis falla justo después del commit.

## DD-050 · Plazo del hold de Mercado Pago (5 días) y N de la saga (3 días)

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-215)</p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Complementa ADR-022. MP\_HOLD\_VALIDITY\_DAYS \= 5 (el mínimo documentado por MP; el sandbox no venció dos holds en unas 188 h, así que la medición no permite subirlo) y FUNDING\_NEAR\_PICKUP\_DAYS \= 3, de modo que N \+ tránsito máximo no supere el plazo del hold (2 días entre retiro y vencimiento, uno de tránsito y uno de margen). Ambos valores son configuración.

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: El plazo no está confirmado en producción ni por banco emisor, y solo se midió Visa crédito. El status\_detail de un hold vencido que asume MOVO-268 sigue sin confirmarse. Con N \= 3, más envíos van por la ruta lejana.

Fuente: fila de resumen del registro de decisiones del repositorio (docs/decisiones/README.md); texto completo en docs/payments/dd-050-plazo-del-hold.md.

## DD-051 · Soporte al usuario sobre el chat existente (MOVO-320)

**Decisión.** Las consultas de soporte viven en movo-svc-shipments (support_conversations, support_messages, support_participant_states) y reusan el ChatHub con otra clave de sala (support:\ ), el handshake WS, el filtro de lenguaje y la push de DD-046 (con categoría propia support).

**Efecto o costo.** Trade-off aceptado: Es una excepción más a “un esquema por servicio” (ADR-003).

## DD-052 · Atribución del no-retiro con evidencia GPS pasiva

**Decisión.** Cada posición de un envío assigned con el viaje activo se clasifica contra el punto de retiro (llegada, lejos o zona gris, según la distancia menos la precisión) y se guarda en shipments.pickup_evidence, sin guardar la traza.

**Efecto o costo.** Trade-off aceptado: La falta de datos nunca culpa a nadie: con mala señal o el pin mal geocodificado, un transportista que llegó puede quedar “sin evidencia”. iOS no informa mocked.

## DD-053 · Oferta de transportistas del recargo por demanda: solo viajes declared

**Decisión.** Ajusta el insumo de ADR-021 (DD-041 no cambia el recargo): countAvailableCarriersNear cuenta solo viajes declared, porque un viaje active ya no toma paquetes (DD-032).

**Efecto o costo.** Trade-off aceptado: Las ocurrencias autogeneradas de viajes recurrentes (DD-042) y los transportistas inhabilitados (MOVO-313, MOVO-278) siguen contando: filtrarlos exigiría consultar otros servicios en cada cotización.

## DD-054 · Disputa sobre un envío completed: la arista completed → disputed

**Decisión.** Se agrega la arista completed → disputed, porque el handshake de entrega captura el hold y pasa el envío a completed en el momento (MOVO-212), y delivered → disputed casi nunca se alcanza.

**Efecto o costo.** Trade-off aceptado: Con el cobro ya acreditado no hay hold que liberar: recuperar la plata queda para MOVO-337 (cuenta corriente, DD-044).

## DD-055 · Cambio forzado de estado de un envío desde el panel

**Decisión.** Una matriz FORCED_TRANSITION_MATRIX en @movo/shared es la fuente de verdad (el panel solo la lee) y POST /internal/admin/shipments/:id/force-status ejecuta el servicio de dominio de cada celda, nunca un UPDATE. Solo se usan aristas que ya existen; la cancelación y la baja hechas por un admin condonan la penalidad; pasar a assigned exige un hold autorizado en payments; disputed, completed, cancelled, in_transit y delivered no se fuerzan.

**Efecto o costo.** Trade-off aceptado: Un envío in_transit o disputed trabado sigue sin salida por el panel (el primero necesita una decisión sobre evidencia, el segundo es MOVO-34).

## DD-056 · Resolución de disputas: matriz de pago, estado final y reembolsos

<p class="adr-cab"><span class="chip lime">Propuesto</span> (MOVO-337)</p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Complementa DD-021, DD-044, DD-052 y DD-054 sin modificarlos. La acción de pago depende del estado en que se abrió la disputa: en assigned (sin hold) no se mueve plata o se acredita el neto en la cuenta corriente del transportista; en in\_transit se libera el hold o se captura total o parcialmente; en delivered o completed se reembolsa total o parcialmente (MOVO-336, que cae a la cuenta corriente del transportista si no tiene saldo) o no se hace nada. El estado final no suma estados nuevos: cancelled si gana el emisor y completed si gana el transportista o la resolución es parcial, con las aristas disputed → completed y disputed → cancelled, que solo usa la resolución. Una resolución parcial lleva un porcentaje de DISPUTE\_PARTIAL\_PRESETS (25/50/75) o un monto libre, que es lo que conserva el transportista; la captura parcial no puede quedar por debajo de la comisión del hold más la de Mercado Pago (422 con el mínimo, validado en svc-admin). La resolución es idempotente en tres pasos (open → resolving → resolved): si la acción de pago falla, la disputa queda en resolving, con alerta y el transportista bloqueado, y se reintenta con los mismos datos. El push dispute\_resolved va sin montos; califica el ganador (en una parcial, las dos partes) y el no-retiro atribuido lo califica el emisor, sin penalización automática.

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: Un reembolso que cae a la cuenta corriente (fallback\_to\_ledger) deja al emisor sin cobrar hasta que el equipo lo resuelva a mano. El crédito en assigned es saldo a favor en la cuenta corriente, no dinero, y un envío delivered cuyo cobro todavía no se acreditó no se puede resolver hasta que se acredite (422 SETTLEMENT\_NOT\_REFUNDABLE).

Fuente: fila de resumen del registro de decisiones del repositorio (docs/decisiones/README.md); texto completo en docs/shipments/dd-056-resolucion-de-disputas.md.

## DD-057 · Plazo de pago extendido ante una falla del proveedor

**Decisión.** En la ruta cercana, un POST /funding que termina en 502 PAYMENT_PROVIDER_ERROR o 502 PAYMENTS_SERVICE_UNAVAILABLE, o con un hold que Mercado Pago no resolvió (creating o in_process), extiende el plazo de assignment_pending hasta la hora del intento más 15 minutos (FUNDING_PROVIDER_EXTENSION_MINUTES), hasta 2 veces por asignación (FUNDING_PROVIDER_MAX_EXTENSIONS) y nunca más allá del cierre de la ventana de retiro.

**Efecto o costo.** Trade-off aceptado: Una caída larga del proveedor igual termina en reversión (30 + 2 × 15 minutos en el peor caso), y el transportista queda reservado hasta 30 minutos más sin pago.

## DD-058 · Bandejas y plazos de la home del panel

**Decisión.** La home del panel muestra ocho bandejas, cada una con su plazo en OVERVIEW_SLA_HOURS de @movo/shared: disputas open, 72 h; soporte open (le toca responder al equipo), 30 minutos desde el último mensaje del usuario; KYC pending o manual_review (último intento de cada verificación de una cuenta viva), 24 h; reportes de usuarios pending, 24 h; envíos en alerta (la regla de isAdminShipmentAlert), 1 h; pagos (holds autorizados que vencen hoy y capturas failed o escalated), 6 h; mensajes señalados, 12 h; sanciones que vencen hoy, sin plazo.

**Efecto o costo.** Trade-off aceptado: Los mensajes señalados no tienen estado de revisión (ni ChatMessage.moderated ni ChatReport se pueden marcar como vistos), así que esa bandeja es una ventana móvil de 7 días y no una cola real: nunca se vacía por atenderla, y con un mensaje de más de 12 h queda fuera de plazo hasta que salga de la ventana.
