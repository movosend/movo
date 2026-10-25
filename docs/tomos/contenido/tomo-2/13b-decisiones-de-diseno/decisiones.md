# Registro de Decisiones de Diseño

Este registro reúne las decisiones de diseño de alcance acotado (las reglas de un módulo, el contrato de un endpoint, el ajuste de un comportamiento) que se tomaron durante los sprints y que no definen la arquitectura ni el stack del sistema. Por eso no forman parte del registro de ADR.

Cada decisión lleva el prefijo **DD** y conserva el número que tenía cuando se registró como ADR, para que las referencias existentes en el código, en los tickets y en los demás documentos sigan siendo válidas: un «ADR» anterior con uno de estos números se lee como DD con el mismo número. Los ADR vigentes están en el documento de Arquitectura del Sistema y se numeran del 001 al 023.

## Índice de decisiones de diseño

| DD | Decisión |
|--------|------------------------------------------------------------|
| DD-016 | Foto de perfil: prefijo profile-photos/ público en S3 con key aleatoria |
| DD-018 | Precio sugerido: implementación lineal provisoria versionada, antes del motor de precios real |
| DD-021 | Set canónico de ShipmentStatus ampliado de 9 a 11 estados |
| DD-023 | Retención de la traza GPS del transportista |
| DD-026 | Bloqueo de usuarios: efecto simétrico sobre envíos y ofertas |
| DD-027 | rejected\_by\_receiver deja de ser terminal: el emisor elige otro receptor o cancela |
| DD-028 | Precio comprometido: cotización congelada de 15 minutos con quoteId |
| DD-029 | Separación de los estados expired y cancelled en viajes |
| DD-030 | Juegos del sitio institucional: prefijo /demo autenticado con API key |
| DD-031 | Juego del optimizador de la feria contra OR-Tools real |
| DD-032 | Expiración y cierre automático de envíos y viajes |
| DD-033 | Navegación turn-by-turn del transportista por deep-link |
| DD-034 | Inicio de viaje: día calendario y paquete ejecutable |
| DD-036 | Requisitos habilitantes del transportista: licencia aprobada + cuenta de Mercado Pago vinculada |
| DD-037 | Saga de asignación: ofertas vivas hasta confirmar el hold y reversión a published |
| DD-038 | Transferencia de receptor como entidad paralela al ciclo de vida del envío |
| DD-039 | Tarjetas guardadas del emisor con re-ingreso de CVV |
| DD-041 | Pricing por peso facturable con distancia achatada |
| DD-042 | Viajes recurrentes: recurrencia como atributo del Trip con generación de la siguiente ocurrencia |
| DD-043 | Refresh idempotente del panel en una ventana de 10 segundos |
| DD-044 | Cuenta corriente del usuario |
| DD-045 | Salida para un envío in\_transit demorado: aviso, disputa automática y bloqueo del transportista |
| DD-046 | Notificaciones push del chat con el texto y ráfagas en un resumen (MOVO-301) |
| DD-047 | Penalidad por cancelar un envío asignado |
| DD-048 | Cuenta cobradora de Movo configurada por credenciales |
| DD-049 | Sanciones de cuenta: suspended y banned |
| DD-050 | Plazo del hold de Mercado Pago (5 días) y N de la saga (3 días) |
| DD-051 | Soporte al usuario sobre el chat existente (MOVO-320) |
| DD-052 | Atribución del no-retiro con evidencia GPS pasiva |
| DD-053 | Oferta de transportistas del recargo por demanda: solo viajes declared |
| DD-054 | Disputa sobre un envío completed: la arista completed → disputed |
| DD-055 | Cambio forzado de estado de un envío desde el panel |

: Índice de las 32 decisiones de diseño.

## DD-016 · Foto de perfil: prefijo profile-photos/ público en S3 con key aleatoria

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-97)</p>

<span class="dd-etq">Contexto</span>


**Situación:** MOVO-97 agrega la foto de perfil. El mobile recorta (1:1), comprime en cliente y sube directo a S3 con una presigned URL. La foto es información pública por diseño (criterio de aceptación 9 de MOVO-97): la contraparte de un envío la usa para reconocer a la persona.

**Alcance:** Primera implementación real de ADR-007.

<span class="dd-etq">Alternativas consideradas</span>


**Alternativa 1:** Bucket 100 % privado con presigned GET en cada lectura. Descartada: photo\_url no sería una URL estable ni cacheable por el cliente.

**Alternativa 2:** Prefijo profile-photos/ de lectura pública, resto del bucket privado (ELEGIDA). La policy de bucket abre solo profile-photos/\* y no hay ListBucket público.

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Bucket S3 con policy de lectura pública acotada al prefijo profile-photos/\* y el resto privado, con key de objeto basada en un UUID aleatorio. photo\_url queda como URL estable y cacheable por el cliente. La subida usa una presigned URL que firma también content-type y content-length (el cliente tiene que mandar esos headers exactos o S3 rechaza la firma). Detrás hay una interfaz StorageProvider con S3StorageProvider y MockStorageProvider; la key del objeto se deriva parseando el photo\_url ya guardado, sin columna nueva. Las credenciales AWS llegan por el IAM role de la EC2. El bucket y su policy están en Terraform (movo-infra), aplicados en dev; prod tiene el código listo sin terraform apply corrido al momento de la decisión.

<span class="dd-etq">Consecuencias</span>


**Trade-offs:** Quien tenga la URL exacta ve la foto sin autenticarse; se acepta porque la foto ya es pública por diseño. A cambio, el cliente cachea la URL sin pedir una firmada nueva en cada lectura. Quedó documentada una ventana de carrera aceptada desde MOVO-97 (cerrada después, ver HISTORIAL de movo-svc-users).

<span class="dd-etq">Referencias</span>


**Referencias:** MOVO-97, ADR-007 (almacenamiento de archivos multimedia).

## DD-018 · Precio sugerido: implementación lineal provisoria versionada, antes del motor de precios real

<p class="adr-cab"><span class="chip lime">Aceptado</span> </p>

<span class="dd-etq">Contexto</span>


**Situación:** La US padre (MOVO-8, "Como emisor, quiero crear un envío...") exige que el sistema calcule y muestre un precio sugerido en ARS al completar peso, dimensiones y destino, considerando al menos distancia, peso y tipo de paquete — y que muestre "precio a estimar" si alguno de esos datos no está completo.

El alcance del proyecto (\[Movo\] 002-Estudio Inicial.md) describe un motor de precios dinámico que además incorpora índice de demanda, precio de combustible y distancia real por calle vía Google Routes API (ADR-015). Implementar ese motor completo junto con el resto de la creación de envíos (MOVO-79/80/81) en el sprint 1 excedía la capacidad del equipo — el propio ticket MOVO-82 lo señala explícitamente: "meter eso completo en el sprint 1 se come el sprint".

A la fecha de esta revisión, movo-svc-pricing-logistics seguía siendo un esqueleto (GET /health únicamente, sin ningún endpoint de negocio) — el único código relacionado era el spike de VRPTW con OR-Tools (MOVO-50), que no calcula precio. Es el punto más barato del proyecto para fijar el contrato correcto antes de escribir el algoritmo final, mismo criterio que ya justificó adoptar Prisma en ADR-011 y migrar a Routes API en ADR-015.

**Criterios:** - Cumplimiento completo del AC de la US padre (precio sugerido, o "precio a estimar" si faltan datos) sin bloquear el resto del flujo de creación de envíos.

  - Esfuerzo de implementación dentro de la capacidad real del sprint 1, con un solo dev disponible para movo-svc-pricing-logistics en paralelo al track de svc-shipments.
  - Honestidad académica: no presentar una fórmula simplificada como si fuera el motor completo en la defensa oral — la memoria escrita necesita justificación documentada de cualquier limitación aceptada.
  - Costo de reemplazo futuro: que el contrato HTTP no tenga que migrarse cuando el motor real exista.
  - Separar "levantar el primer servicio de negocio en Python/FastAPI del monorepo" de "escribir el algoritmo definitivo" — son dos riesgos distintos que conviene no acoplar en un mismo ticket.

<span class="dd-etq">Alternativas consideradas</span>


**Alternativa 1:** Bloquear la creación de envíos hasta tener el motor de precios real completo.

Pros: nunca se le muestra al emisor un precio inexacto.

Contras: viola el AC explícito de la US padre — "precio a estimar" es un estado válido y esperado, no una degradación a evitar. Introduce un acoplamiento duro entre movo-svc-shipments y movo-svc-pricing-logistics sin justificación de negocio (ADR-001 ya acepta el acoplamiento temporal de REST síncrono, pero no bloquear un flujo completo por un servicio no crítico). El sprint 1 se extendería indefinidamente: ni el índice de demanda ni el precio de combustible tienen todavía fuente de datos ni definición de negocio, y las credenciales de Google Maps seguían sin cargar (mismo estado que Twilio/Didit).

**Alternativa 2:** Implementar el motor de precios real completo (demanda + combustible + Google Routes API) en este mismo ticket.

Pros: no hay que volver a tocar el cálculo de precio más adelante.

Contras: sobre-alcance declarado explícitamente por el propio ticket MOVO-82 — se come el sprint completo. Google Routes API todavía no tenía credenciales provisionadas. El índice de demanda no tiene ni fuente de datos ni criterio de negocio definido (¿oferta de transportistas por zona? ¿por franja horaria? nadie lo había refinado). Se descartó por el mismo motivo que llevó a acotar el alcance del resto de MOVO-8 (MOVO-83 diferido a sprint 2).

**Alternativa 3:** Contrato estable POST /quote (tipado en shared/movo-shared, consumido por movo-svc-shipments vía un cliente HTTP dedicado) con una implementación provisoria versionada explícitamente, y fallback a "precio a estimar" si el servicio no responde o los datos están incompletos.

Pros: cumple el AC completo de la US padre, incluida la rama de datos incompletos. Separa contrato de implementación — el motor real reemplaza el algoritmo sin migrar a los consumidores. Primera pieza de negocio real de movo-svc-pricing-logistics (antes solo un esqueleto), lo que además habilita a MOVO-83 (wizard mobile) a integrarse contra un contrato estable. La honestidad queda explícita en el propio payload (calculationMethod), no relegada a un comentario en el código.

Contras: el precio mostrado no refleja demanda, combustible ni tráfico real hasta que el motor real lo reemplace. La distancia euclidiana (no geodésica, no por calle) introduce un margen de error adicional, aceptado a la escala urbana/interurbana en la que opera MOVO.

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Se adopta el contrato POST /quote en movo-svc-pricing-logistics, tipado en shared/movo-shared/src/types/pricing.ts (QuoteRequest/QuoteResponse/PriceCalculationMethod) y consumido desde movo-svc-shipments vía src/adapters/pricing-client.ts.

La implementación de este sprint calcula el precio con una fórmula lineal (base + distanciaKm·tarifaKm + pesoKg·tarifaKg, escalada por un factor según packageType), usando distancia euclidiana entre coordenadas (proyección equirectangular: los grados se convierten a km escalando la longitud por cos(latitud promedio), y recién ahí se aplica Pitágoras). Los coeficientes de la fórmula viven en configuración (env vars con prefijo PRICING\_), no hardcodeados, para poder ajustarlos durante las pruebas sin rebuildear la imagen.

La versión del algoritmo queda identificada explícitamente en cada respuesta (calculationMethod: "euclidean\_linear\_v1") y se persiste junto al precio en shipments.shipments.calculation\_method — un envío ya creado nunca se recalcula retroactivamente, así que un cambio de fórmula a futuro no altera precios ya cotizados.

Si movo-svc-pricing-logistics no responde, hace timeout, o faltan datos necesarios (peso, dimensiones o coordenadas), movo-svc-shipments no bloquea la creación del envío: persiste suggested\_price\_ars = null (junto con calculation\_method = null), que la API expone como el indicador de "precio a estimar" exigido por el AC de la US padre.

Se deja registrado en el backlog (MOVO-138, sin refinar todavía) el motor de precios real — índice de demanda, precio de combustible y distancia real por calle vía Google Routes API (ADR-015) — que reemplazará euclidean\_linear\_v1 con un nuevo valor de PriceCalculationMethod, nunca reusando ni renombrando el existente.

<span class="dd-etq">Consecuencias</span>


**Trade-offs:** Positivo: cumple el AC completo de la US padre (MOVO-8), incluida la rama de "precio a estimar" para datos incompletos — no es un recorte de alcance silencioso.

Positivo: movo-svc-pricing-logistics deja de ser un esqueleto vacío — primer endpoint de negocio real del servicio, y primer contacto real del equipo con FastAPI en el monorepo.

Positivo: el contrato queda listo para el motor real sin requerir cambios en los consumidores (movo-svc-shipments, y a futuro el wizard mobile de MOVO-83) — reemplazarlo es agregar un valor de enum, no renegociar un contrato.

Positivo: académicamente defendible — la implementación provisoria está versionada y expuesta explícitamente en cada respuesta (calculationMethod), nunca presentada como el motor completo ante la cátedra.

Trade-off negativo: el precio sugerido que ve el emisor es inexacto (no refleja demanda, combustible ni tráfico real) hasta que MOVO-138 reemplace euclidean\_linear\_v1 — mitigado por el propio nombre del calculationMethod, visible en cada respuesta y persistido.

Trade-off negativo: MOVO-138 (el motor real) queda en el backlog sin refinar — sin criterios de aceptación detallados ni estimación — con el riesgo de quedar indefinidamente pospuesto si no se prioriza en un sprint futuro.

## DD-021 · Set canónico de ShipmentStatus ampliado de 9 a 11 estados

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-208)</p>

<span class="dd-etq">Contexto</span>


**Situación:** El set de 9 estados se cerró en MOVO-79 y se modeló en el DTE de MOVO-105. Dos decisiones posteriores necesitaban estados propios: el hold de fondos anclado cerca del retiro en lugar de en la aceptación de la oferta (MOVO-12) y distinguir "entregado" de "entregado y cobrado" (MOVO-212). El diseño original de MOVO-12 (método de pago validado al aceptar más un hold programado automático a T-24h) se descartó por el spike MOVO-49: tarjeta guardada más cobro sin el emisor presente no se pudo validar en marketplace.

**Alcance:** Su arista assigned → assigned\_unfunded fue agregada después por DD-037.

<span class="dd-etq">Alternativas consideradas</span>


**Alternativa 1:** delivery\_failed. Evaluado y descartado explícitamente: quedaban cinco preguntas de negocio sin responder (ver docs/shipments/state-diagram.md).

**Alternativa 2:** completed como resultado alternativo de delivered. Descartado: completed es una consecuencia posterior de delivered, no una alternativa.

<span class="dd-etq">Decisión</span>


**Decisión tomada:** El enum pasa a 11 valores, en @movo/shared, en Postgres y en la máquina de estados, en el mismo PR. assigned\_unfunded: transportista asignado sin hold creado porque el retiro es a más de N días; cuando el retiro entra en N días se abre una ventana para que el emisor confirme el pago con la app abierta (crea el hold y pasa a assigned), y sin pago a T-24h vuelve a published. Es una rama alternativa a assignment\_pending desde published, y nunca sale directo a in\_transit. completed: entrega confirmada y pago liberado, terminal, solo entra desde delivered. La migración se escribió a mano con dos ALTER TYPE ... ADD VALUE; la reversibilidad (Postgres no soporta DROP VALUE) está documentada en la propia migración y probada en un test de integración. Cuatro lugares que comparaban status === DELIVERED pasan a tratar completed como equivalente (FULFILLED\_SHIPMENT\_STATUSES).

<span class="dd-etq">Consecuencias</span>


**Trade-offs:** Al momento de la decisión ninguna de las dos transiciones nuevas se disparaba todavía (bloqueadas por Mercado Pago, MOVO-210 y MOVO-212): la máquina de estados permitía un camino que ningún endpoint HTTP disparaba, documentado como "disponible y probado, no disparado" en vez de dejarlo implícito. Revisiones posteriores: completed dejó de ser terminal con DD-054 (arista completed → disputed) y DD-037 agrega assigned → assigned\_unfunded.

<span class="dd-etq">Referencias</span>


**Referencias:** MOVO-79, MOVO-105 (DTE), MOVO-208 (este ticket), MOVO-12, MOVO-49, MOVO-210, MOVO-212, DD-037, DD-054, docs/shipments/state-diagram.md.

## DD-023 · Retención de la traza GPS del transportista

<p class="adr-cab"><span class="chip lime">Aceptado</span> </p>

<span class="dd-etq">Contexto</span>


**Situación:** MOVO-202 (ingesta de posiciones del transportista durante in\_transit) exige persistir la traza completa, no solo la última posición — decisión de producto del 08/09/2026, con el propósito declarado de dejar evidencia para disputas (MOVO-30), nunca analítica ni perfilado. Persistir el desplazamiento georreferenciado de una persona física es tratamiento de datos personales sensibles (Ley 25.326) — el proyecto ya implementó el derecho de supresión (MOVO-39, Done), así que el criterio de minimización y borrado ya existe en el proyecto y este ticket tiene que respetarlo, no inventar uno nuevo. El propio ticket advertía explícitamente: sin retención acotada y purga automática real, esto es un hallazgo directo en la defensa del PF y un problema real de cumplimiento, no solo un detalle técnico.

**Criterios:** Propósito declarado (evidencia operativa de disputas, no analítica) como techo de cuánto conviene retener; principio de minimización de datos (Ley 25.326) sobre geolocalización, la categoría de dato más sensible que maneja el proyecto hasta ahora; que el plazo sea ejecutable por un job real dentro del alcance del PF (un servidor, sin infraestructura de colas/cron externa, ADR-006) y no quede como intención sin código; que la existencia de una disputa abierta (MOVO-30) no permita que la purga borre evidencia que todavía hace falta; consistencia con el precedente de ventanas cortas ya aceptado en el proyecto (72hs para calificar, MOVO-146) en vez de inventar un criterio aislado.

<span class="dd-etq">Alternativas consideradas</span>


**Alternativa 1:** Sin plazo fijo / purga manual a demanda: Pros: no había que definir un número arbitrario; simple de implementar (nada que programar). Contras: exactamente lo que el ticket advertía evitar — sin un job real y probado, la retención queda como intención, no como control efectivo; acumula datos de geolocalización sensibles indefinidamente sin justificación de propósito, el escenario de mayor riesgo de cumplimiento; ningún costo de mantenimiento pero el mayor pasivo legal.

**Alternativa 2:** 30 días desde el cierre del envío (ELEGIDA): Pros: cubre con margen amplio la ventana típica en que una disputa se abre después de una entrega, bien por encima de las 72hs que ya rigen la ventana de calificación (MOVO-146); minimiza el tiempo que se retiene un dato sensible sin necesidad real, más alineado al principio de minimización que un plazo largo; job de purga simple (setInterval + lock de Redis, mismo patrón ya aceptado en el proyecto para MOVO-124/MOVO-130) sin infraestructura nueva. Contras: corta frente a un litigio civil que escale mucho después de esos 30 días — mitigado por la excepción de disputed (ver Decisión); es un número de equipo, no derivado de una norma específica, y así queda documentado, no presentado como obligación legal que no es.

**Alternativa 3:** 90 días desde el cierre del envío: Pros: más margen si una disputa demora en escalar o el usuario tarda en reclamar. Contras: retiene geolocalización sensible el triple de tiempo sin que el propósito declarado (evidencia para disputas, no analítica) lo justifique — contradice el principio de minimización que el propio ticket invocaba; sin ningún caso de uso comprometido hoy que necesite ese margen extra.

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Se adopta un plazo de 30 días desde que el envío cierra (estados delivered/completed/cancelled/rejected by receiver — POSITION\_PURGE\_ELIGIBLE\_STATUSES en shipment-state-machine.ts), anclado en Shipment.lastStatusChangedAt (columna ya existente, mantenida por updateStatus() desde MOVO-104/105, sin necesidad de una columna nueva). Un envío en disputed nunca es candidato a purga mientras siga en ese estado — la traza puede ser evidencia de la disputa en curso. Como disputed no tiene hoy ninguna transición de salida modelada (mismo vacío que dejó pendiente DD-021), en la práctica la traza de un envío disputado queda retenida sin límite mientras dure; el día que exista una transición real de salida, el plazo de 30 días cuenta desde ese momento (la resolución), nunca desde el cierre original anterior a la disputa — consecuencia directa de anclar en lastStatusChangedAt en vez de en un timestamp de “primer cierre”, sin requerir ningún cambio de código cuando esa transición se modele. La purga corre por job periódico (carrier-position-purge-sweep.ts, cada 60 minutos por default, configurable vía CARRIER\_POSITION\_PURGE\_SWEEP\_INTERVAL\_MINUTES), mismo mecanismo ya aceptado en el proyecto para los barridos de MOVO-124/MOVO-130 y el de retiro vencido de published (MOVO-39). La supresión de cuenta no espera los 30 días: al dar de baja una cuenta, la traza del usuario como transportista se borra de inmediato mediante un endpoint interno nuevo (DELETE /internal/account-deletion/users/:userId/carrier-positions), llamado best-effort desde movo-svc-users — es supresión de datos personales a pedido, un caso distinto del ciclo de vida normal de retención, y no bloquea la baja de cuenta si movo-svc-shipments no responde (el barrido periódico la alcanza más tarde si el envío ya cerró)..

<span class="dd-etq">Consecuencias</span>


**Trade-offs:** Positivo — minimiza el tiempo que se retiene un dato de geolocalización sensible sin necesidad real, alineado al propósito declarado (evidencia operativa, no analítica). Positivo — la excepción de disputed evita el escenario más grave (borrar evidencia mientras una disputa sigue abierta) sin necesitar todavía una fecha de resolución real, que no existe en el proyecto. Positivo — el job de purga existe, está probado (incluido el caso disputed) y corre con el mismo mecanismo ya validado en el proyecto (Redis lock + setInterval), no queda como intención.

Trade-off negativo — 30 días es corto frente a un litigio civil que escale mucho después de ese plazo; se acepta porque el propósito declarado de esta traza es evidencia operativa de una disputa gestionada por la plataforma (MOVO-30), no evidencia judicial de largo plazo, y la excepción de disputed cubre el caso donde la evidencia todavía hace falta. Trade-off negativo — el borrado cross-service de la supresión de cuenta es best-effort, no transaccional (no hay 2PC entre movo-svc-users y movo-svc-shipments, ADR-001) — si falla, depende del barrido periódico para llegar más tarde; el escenario de un transportista con un envío todavía activo dándose de baja ya está bloqueado aguas arriba (MOVO-134 que cerró envíos activos), así que en la práctica el riesgo real es bajo.

Alternativa a reabrir si cambian las condiciones: si el equipo define una transición real de salida de disputed (resolución de disputas, MOVO-30/32), o si surge un requisito legal/contractual que exija un plazo distinto, ahí hay una razón concreta para revisar el número — mientras esas condiciones no existan, no está justificado extenderlo.

## DD-026 · Bloqueo de usuarios: efecto simétrico sobre envíos y ofertas

<p class="adr-cab"><span class="chip lime">Aceptado</span> </p>

<span class="dd-etq">Contexto</span>


**Situación:** El rediseño de la pantalla de perfil (MOVO-176) incorpora un menú para reportar y bloquear a otro usuario (MOVO-175). Hasta ese momento no existía ningún concepto de trust & safety en el sistema: ni en el backlog, ni en el esquema de datos. La relación de bloqueo es un dato de identidad y por lo tanto vive en movo-svc-users, pero su efecto recae casi por completo en movo-svc-shipments: el feed de envíos disponibles, los envíos compatibles con un viaje declarado, las ofertas, la asignación del transportista y la designación del receptor. Hay que definir qué significa bloquear para el resto del sistema, en qué dirección aplica, qué ve la persona bloqueada, qué pasa con los envíos que ya están en curso entre ambas partes y cómo se comporta el sistema si movo-svc-users no responde en el momento de consultar el bloqueo.

**Criterios:** Protección real de quien bloquea: que la otra persona no pueda seguir iniciando interacciones con ella, no solo dejar de verla. Consistencia con ADR-001 (comunicación REST síncrona, sin message broker) y ADR-010 (endpoints internos protegidos de forma perimetral). Consistencia con el criterio ya aceptado en MOVO-134 para la baja de cuenta: nada se cancela en cascada, cada parte resuelve lo que ya tiene en curso. Disponibilidad: una falla de movo-svc-users no debería dejar inutilizable el feed de envíos. Paginación correcta de los listados filtrados. Costo de implementación acotado al alcance del PF.

<span class="dd-etq">Alternativas consideradas</span>


**Alternativa 1:** Alcance del bloqueo. (a) Solo ocultar a la otra persona de los listados propios. Pros: implementación mínima, sin llamadas nuevas entre servicios en las escrituras. Contras: el bloqueado podría seguir ofertando sobre los envíos de quien lo bloqueó, o ser designado como receptor; el bloqueo sería una preferencia visual y no una protección. (b) Limitarlo a la relación social (perfil, y en el futuro chat) sin tocar envíos. Pros: cero impacto en movo-svc-shipments. Contras: en MOVO la interacción real entre desconocidos ocurre justamente en envíos y ofertas, así que el bloqueo no cubriría el caso de uso principal. (c) Ocultar e impedir nuevas interacciones (ELEGIDA). Pros: el bloqueo protege de verdad. Contras: movo-svc-shipments pasa a depender de movo-svc-users en operaciones de escritura.

**Alternativa 2:** Dirección del bloqueo. (a) Unidireccional: solo quien bloquea deja de ver a la otra persona. Contras: el bloqueado seguiría viendo los envíos de quien lo bloqueó en el feed Transportar, y la única barrera sería un error al intentar ofertar, un camino que invita a reintentar. (b) Simétrica (ELEGIDA): un bloqueo en cualquier dirección separa a los dos usuarios en todos los listados e interacciones. Se persiste igualmente una fila por dirección (quién bloqueó a quién), porque la dirección sí importa para mostrar "Desbloquear" y para la lista propia de bloqueados; la simetría se resuelve al consultar, uniendo ambas direcciones.

**Alternativa 3:** Qué se comunica al bloqueado. (a) Error genérico ("el envío ya no está disponible"), sin revelar el bloqueo. Pros: discreción, al estilo de las redes sociales. Contras: mensajes engañosos que llevan a reintentar o a reportar un bug, y un comportamiento difícil de explicar en la defensa del proyecto. (b) Error explícito 403 USER\_BLOCKED (ELEGIDA). Pros: claridad para el usuario y para el soporte. Contras: revela que hubo un bloqueo. El perfil público de quien bloqueó se sigue mostrando con normalidad: es público por diseño (DD-016) y la contraparte de un envío en curso necesita poder reconocer a la persona.

**Alternativa 4:** Comportamiento si movo-svc-users no responde. (a) Fallar siempre cerrado: una caída de movo-svc-users también tira el feed de envíos y las ofertas recibidas. (b) Fallar siempre abierto: el bloqueo pasa a ser best-effort incluso en las escrituras, y durante una caída el bloqueado podría ofertar o ser asignado. (c) Mixto (ELEGIDA): las escrituras (crear oferta, aceptar oferta, designar receptor) fallan cerradas con 502, igual que el chequeo de KYC ya existente; los listados y el push de envío compatible fallan abiertos, se muestran sin filtrar y dejan un warning en los logs.

**Alternativa 5:** Dónde se consulta el bloqueo. (a) Replicar la relación en el schema shipments (tabla espejo o cache). Contras: sin message broker (ADR-001), mantener la réplica consistente requiere escrituras duales o sincronización periódica, con una ventana de inconsistencia en la dirección insegura. (b) Consultar a movo-svc-users por HTTP en cada operación (ELEGIDA): un endpoint interno GET /internal/users/:id/block-relations devuelve la unión simétrica de ids. Contras: una llamada de red extra en cada operación afectada.

<span class="dd-etq">Decisión</span>


**Decisión tomada:** La relación de bloqueo vive en movo-svc-users (users.user\_blocks, una fila por dirección) y su efecto es simétrico. movo-svc-users expone POST y DELETE /users/:id/block, GET /users/me/blocked (solo la lista propia, nunca quién bloqueó al usuario) y el endpoint interno GET /internal/users/:id/block-relations, que devuelve la unión de ambas direcciones. El perfil público incluye isBlockedByMe solo al mirar a otro usuario, sin revelar nunca la dirección inversa, y la búsqueda de receptor excluye a cualquier usuario con un bloqueo en cualquier dirección. movo-svc-shipments aplica el bloqueo en dos modos. Falla cerrado, con 403 USER\_BLOCKED explícito, al crear una oferta (transportista contra emisor y receptor), al aceptar una oferta hecha antes del bloqueo y al designar el receptor de un envío nuevo. Falla abierto al filtrar el feed de envíos disponibles y los envíos compatibles con un viaje, con el filtro dentro del WHERE compartido entre la consulta de datos y la de conteo para que la paginación sea correcta; también al filtrar las ofertas pendientes que ve el emisor y el push de envío compatible con un viaje. Los envíos ya en curso entre ambas partes no se cancelan ni se modifican. Al dar de baja una cuenta se borran sus bloqueos en ambas direcciones; los reportes (users.user\_reports) se conservan como evidencia para administración. Los reportes solo se persisten: se admite un único reporte pendiente por par de usuarios (reportar de nuevo es idempotente) y un máximo de 10 reportes nuevos por día por usuario.

<span class="dd-etq">Consecuencias</span>


**Trade-offs:** Positivo: el bloqueo protege efectivamente a quien bloquea: la otra persona deja de verla y no puede iniciar ninguna interacción nueva. Positivo: el feed de envíos sigue disponible aunque movo-svc-users no responda, y ninguna interacción se concreta sin haber pasado por un chequeo que falla cerrado. Positivo: una única fuente de verdad, sin réplicas que sincronizar. Trade-off negativo: la persona bloqueada se entera del bloqueo al intentar interactuar; se prioriza la claridad sobre la discreción. Trade-off negativo: durante una caída de movo-svc-users los listados pueden mostrar a alguien bloqueado; se acepta porque cualquier acción posterior vuelve a chequear y falla cerrada. Trade-off negativo: movo-svc-shipments suma una llamada HTTP síncrona a movo-svc-users en cada creación o aceptación de oferta, en cada creación de envío y en cada consulta del feed; es un acoplamiento temporal adicional, ya aceptado como costo general de ADR-001. Trade-off negativo: la relación de bloqueo no se cancela en cascada sobre envíos en curso, así que dos usuarios bloqueados pueden seguir vinculados por un envío existente hasta que termine o lo cancelen (mismo criterio que MOVO-134). Limitación aceptada: los reportes se persisten sin una interfaz de revisión; la moderación desde el panel de administración queda para una US posterior.

## DD-027 · rejected\_by\_receiver deja de ser terminal: el emisor elige otro receptor o cancela

<p class="adr-cab"><span class="chip lime">Aceptado</span> </p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** rejected\_by\_receiver deja de ser terminal (MOVO-253, reemplaza en ese punto a MOVO-79/DD-021): el emisor tiene un plazo (receiver\_redesignation\_deadline, 48hs con tope en la ventana de retiro) para elegir otro receptor (POST /shipments/:id/receiver, vuelve a awaiting\_receiver\_confirmation) o cancelar; si no, el barrido de MOVO-130 lo pasa a cancelled. Mismo molde “estado con deadline + barrido” que la confirmación del receptor, en vez de decidir en el cliente según la hora

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: El terminal real de un rechazo pasa a ser cancelled (el rechazo queda como evento en la línea de tiempo); quien rechazó pierde acceso al envío apenas se elige a otra persona (el acceso sigue a receiverId); solo se cambia la persona, nunca la dirección de entrega, así el precio sugerido sigue sin recalcularse (MOVO-82 AC8)

Fuente: fila de resumen del registro de ADRs del repositorio; no tiene borrador extendido.

## DD-028 · Precio comprometido: cotización congelada de 15 minutos con quoteId

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-255)</p>

<span class="dd-etq">Contexto</span>


**Situación:** MOVO-255 hace que el resumen del wizard de envío muestre una cotización real y que el envío se cree exactamente a ese precio. Para eso la cotización usa la misma función que la creación (quoteShipment, extraída en MOVO-138).

**Alcance:** Complementa ADR-021.

<span class="dd-etq">Decisión</span>


**Decisión tomada:** POST /shipments/quote cotiza con la misma función que la creación y, si hay precio, lo guarda en Redis (shipment\_quote:{quoteId}, TTL de 15 minutos, constante y no variable de entorno) ligado al usuario y a un fingerprint de los datos que afectan el precio (SHA-256 de tipo, peso, dimensiones y coordenadas redondeadas a 6 decimales). POST /shipments acepta un quoteId opcional: con él crea el envío exactamente a ese precio, sin llamar a pricing. La cotización es de un solo uso y se consume con un script Lua que compara antes de borrar, de modo que un quoteId ajeno o mandado con otros datos no quema la cotización del dueño. Un quoteId inexistente, vencido, usado o de otro usuario responde 409 QUOTE\_EXPIRED (sin revelar que el id existe) y uno con fingerprint distinto 409 QUOTE\_MISMATCH (la cotización queda viva); nunca se recalcula en silencio. Se consume después de las validaciones de createShipment (receptor, KYC, bloqueo, franja) para que un 422 no la queme. Descripción, direcciones escritas y franja no entran al fingerprint porque no afectan el precio.

<span class="dd-etq">Consecuencias</span>


**Trade-offs:** El emisor que tarda más de 15 minutos o cambia datos que afectan el precio tiene que volver a confirmar uno nuevo. Sin quoteId (pricing caído o builds viejos del mobile) el backend sigue cotizando al crear, con un precio que el emisor no vio ("precio a estimar").

<span class="dd-etq">Referencias</span>


**Referencias:** MOVO-138 (quoteShipment), MOVO-255 (este ticket), ADR-021 (motor de precios dinámico), DD-041 (pricing por peso facturable).

## DD-029 · Separación de los estados expired y cancelled en viajes

<p class="adr-cab"><span class="chip lime">Aceptado</span> </p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Separación de estado expired y cancelled en viajes (MOVO-260): se introduce TripStatus.EXPIRED para viajes vencidos por el cronjob trip-expiry-sweep.ts, diferenciándolos de TripStatus.CANCELLED que ahora se usa para la cancelación lógica explícita del transportista (POST /trips/:id/cancel). El borrado físico (DELETE /trips/:id) queda deprecado

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: Desacoplamiento semántico que permite a la UI diferenciar un viaje vencido por inactividad de uno cancelado manualmente; mantiene historial completo de la actividad del transportista, lo que sirve para trazabilidad y métricas

Fuente: fila de resumen del registro de ADRs del repositorio; no tiene borrador extendido.

## DD-030 · Juegos del sitio institucional: prefijo /demo autenticado con API key

<p class="adr-cab"><span class="chip lime">Aceptado</span> </p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Juegos del sitio institucional (movo-institucional /juegos, primero el juego de precios de la feria): el gateway autentica el prefijo /demo con API key (DEMO\_API\_KEYS, header x-api-key) en vez de JWT, solo desde el servidor de Next (sin CORS); POST /quote de pricing acepta includeBreakdown opt-in, que solo pide el módulo demo de svc-shipments (el emisor sigue sin desglose, ADR-021 intacto); partidas en shipments.pricing\_game\_sessions

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: Primer cliente sin usuario: una key filtrada permite cotizar (Google Routes, pago) y escribir partidas hasta rotarla, mitigado con rate limit por visitante y keys por cliente; el desglose de la fórmula queda visible en el juego (es justamente lo que se quiere mostrar en la feria)

Fuente: fila de resumen del registro de ADRs del repositorio; no tiene borrador extendido.

## DD-031 · Juego del optimizador de la feria contra OR-Tools real

<p class="adr-cab"><span class="chip lime">Aceptado</span> </p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Juego del optimizador de la feria (movo-institucional /juegos/optimizador): compite contra el OR-Tools real de POST /optimize/route, con dos opt-in que solo usa el módulo demo de svc-shipments (objective: "distance" y matrix precalculada); la matriz de cada ciudad (pool fijo) se pide una vez a POST /routes/matrix y se cachea 30 días en Redis, así la feria completa factura \~487 elementos de Google en vez de \~49 por partida. Ranking del día compartido entre iPads en shipments.route\_game\_sessions

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: La matriz cacheada no refleja cambios de tránsito durante el evento (irrelevante para comparar órdenes); el ranking muestra nombres que el visitante elige en un stand público, y quien tenga la key demo puede reiniciarlo (mismo riesgo que DD-030)

Fuente: fila de resumen del registro de ADRs del repositorio; no tiene borrador extendido.

## DD-032 · Expiración y cierre automático de envíos y viajes

<p class="adr-cab"><span class="chip lime">Aceptado</span> </p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Expiración y cierre automático (MOVO-258, revisa “bloquea, no cascadea” de MOVO-238): todo envío con transportista (assignment\_pending/assigned\_unfunded/assigned) se cancela sin culpables 24h después de cerrar su ventana de retiro efectiva (la acordada, copiada al envío al aceptar la oferta); cancelar un envío cierra sus ofertas (pending vigentes y accepted → nuevo OfferStatus.shipment\_cancelled) en la misma transacción y eso destraba al viaje sin cascada explícita; un published sigue vivo mientras tenga ofertas vigentes (solo lo protege de la cancelación: deja de ofrecerse y no recibe ofertas nuevas); un in\_transit que no se entrega se MARCA para revisión (entrega estimada + 50% de la duración) y nunca se cancela; los paquetes de un viaje quedan fijos al iniciarlo (start() exige ≥1 paquete; solo un viaje declared recibe ofertas, matches y el push de paquete compatible) y un viaje active pasa a completed cuando todos sus paquetes terminaron (disputed cuenta como terminado: sin salida modelada, retenerlo trabaría al transportista para siempre), o se cancela si se queda sin ninguno

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: Sin penalización ni atribución de responsabilidad (quién faltó queda para un ticket aparte con geolocalización); delivered→completed y la reversión por hold fallido siguen dependiendo de Mercado Pago (MOVO-210/212); el in\_transit anómalo solo avisa al transportista y deja la marca, sin disputa automática ni alerta de admin todavía; el conteo de oferta de transportistas del pricing (ADR-021) sigue contando viajes active pese a que ya no toman paquetes, pendiente en MOVO-270

Fuente: fila de resumen del registro de ADRs del repositorio; no tiene borrador extendido.

## DD-033 · Navegación turn-by-turn del transportista por deep-link

<p class="adr-cab"><span class="chip lime">Aceptado</span> </p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Navegación turn-by-turn del transportista (MOVO-237): se delega por deep-link a la app de mapas del dispositivo (Google Maps nativo → Waze → Google Maps web, movo-mobile/src/lib/navigation-deeplink.ts) en vez del Navigation SDK de Google o re-routing propio. RoutesProvider (svc-shipments) gana mode: "per\_trip" | "live": per\_trip es el polyline estático de siempre (default, MOVO-123) y live queda tipado pero falla con 501 ROUTE\_MODE\_NOT\_IMPLEMENTED, como placeholder intencional para una navegación 100% in-app futura

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: Costo cero para Movo a cambio de que la navegación salga de la app (el tracking en segundo plano de MOVO-242 sigue emitiendo, pero el transportista tiene que volver a Movo para confirmar cada parada); el Navigation SDK (\~US$25/1.000, 5x Compute Routes) queda descartado hasta que haya una razón de producto para pagarlo. El ticket lo numeraba ADR-019, ya ocupado por el canal WebSocket

Fuente: fila de resumen del registro de ADRs del repositorio; no tiene borrador extendido.

## DD-034 · Inicio de viaje: día calendario y paquete ejecutable

<p class="adr-cab"><span class="chip lime">Aceptado</span> </p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Inicio de viaje (MOVO-277, complementa DD-032 sin modificarlo): POST /trips/:id/start exige que el día calendario argentino de departureAt ya haya llegado (canStartTripOn, @movo/shared, la misma función que decide el botón en el mobile) y al menos un paquete ejecutable. “Paquete ejecutable” (TRIP\_EXECUTABLE\_SHIPMENT\_STATUSES = assigned/in\_transit, shipment-state-machine.ts) pasa a ser la única definición que usan start(), la ruta del viaje, el tracking y el conteo executablePackagesCount de /trips; “paquete aceptado” (ACCEPTED\_OFFER\_FILTER) sigue rigiendo lo que bloquea editar/cancelar y el cierre de un viaje active

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: Mientras no exista el hold de fondos (MOVO-210) ningún envío llega a assigned, así que ningún viaje se puede iniciar desde la app (en dev hay que forzar el estado); a cambio, un viaje ya no queda active semanas antes ni con “N paquetes” y “Sin paradas asignadas”, bloqueando al transportista por el índice de 1 viaje activo. Trade-off aceptado: un viaje “mixto” (al menos un paquete ejecutable más otros en assignment\_pending/assigned\_unfunded) se puede iniciar, y los no ejecutables quedan fuera de la ruta y del retiro pero siguen contando como aceptados, así que completeFinishedActive no lo cierra hasta que el barrido de DD-032 los cancele (24h después de su ventana de retiro); mientras tanto el índice de 1 viaje activo mantiene bloqueado al transportista. Hoy es teórico (ningún envío llega a assigned hasta MOVO-210); la alternativa descartada por ahora es desasociar los no ejecutables al iniciar, como ya se hace con las ofertas pending

Fuente: fila de resumen del registro de ADRs del repositorio; no tiene borrador extendido.

## DD-036 · Requisitos habilitantes del transportista: licencia aprobada + cuenta de Mercado Pago vinculada

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-116)</p>

<span class="dd-etq">Contexto</span>


**Situación:** Hasta MOVO-116, operar como transportista (declarar un viaje, ofertar) solo exigía el rol carrier y el KYC de identidad aprobado. MOVO-142 había decidido explícitamente no exigir la licencia de conducir: alguien sin auto puede llevar un paquete en micro, tren o avión.

Dos problemas con eso:

  - Mercado Pago: sin una cuenta vinculada y vigente (MOVO-111), el transportista no puede cobrar. Hoy lo descubre recién el hold (MOVO-209, 409 CARRIER\_MP\_ACCOUNT\_NOT\_LINKED), cuando el emisor ya eligió su oferta: el envío queda trabado y el emisor tiene que volver a elegir.
  - Licencia: el equipo decidió que la insignia de "transportista verificado" pase a ser condición para operar (MOVO-116 lo pide explícito), aceptando que se pierde el caso del transportista sin vehículo propio.

**Alcance:** Revierte, en ese punto, la decisión de MOVO-142 ("la licencia de conducir es una insignia de confianza, no un permiso de acceso").

<span class="dd-etq">Alternativas consideradas</span>


**Alternativa 1:** Mantener la licencia como insignia (MOVO-142) y exigir solo Mercado Pago: descartado por decisión de producto.

**Alternativa 2:** Leer la licencia de PublicProfile.badges (license\_verified) con la llamada que ya existía: cero endpoints nuevos, pero ata un control de acceso a una derivación pensada para mostrar en el perfil, y GET /users/:id además pide la reputación a svc-shipments.

**Alternativa 3:** Cachear el resultado en Redis (criterio 4 del ticket): cachear un negativo deja bloqueado a quien acaba de vincular su cuenta; cachear solo los positivos deja operar unos minutos a quien acaba de desvincularse. Las escrituras protegidas son pocas por transportista, así que el costo de no cachear es bajo.

**Alternativa 4:** Un código combinado para "faltan los dos": combinatoria rígida que crece con cada requisito nuevo; details escala sin códigos nuevos.

<span class="dd-etq">Decisión</span>


**Decisión tomada:** 1. Para operar como transportista hacen falta tres cosas: KYC de identidad aprobado (prerequisito, igual que antes), licencia de conducir aprobada (kyc\_status\_license = approved, svc-users) y una cuenta de Mercado Pago con la que hoy se pueda cobrar (svc-payments, mismo criterio que el hold: no desvinculada, no revocada, token sin vencer y con public\_key).

2\. Dónde se exige (svc-shipments, utils/carrier-gate.ts): declarar viaje (POST /trips), ofertar (POST /shipments/:id/offers), editar una oferta (PATCH /offers/:id) e iniciar un viaje (POST /trips/:id/start, sobre el dueño del viaje). Al aceptar una oferta (POST /offers/:id/accept) se revalida al transportista y, si ya no cumple, el emisor recibe 409 OFFER\_CARRIER\_NOT\_ELIGIBLE sin detalle y la oferta sigue pending. Las lecturas (feed, detalle de un envío publicado, mis viajes, matches) siguen pidiendo solo identidad: se puede mirar antes de completar los requisitos.

3\. Error explícito y accionable: 403 con code = el primer requisito que falta (CARRIER\_LICENSE\_NOT\_APPROVED, si no CARRIER\_MP\_ACCOUNT\_NOT\_LINKED) y details.missingRequirements con todos (\["license", "mp\_account"\]). Para eso ApiError (@movo/shared) gana un campo details opcional, compatible hacia atrás.

4\. Consulta síncrona REST sin cache (ADR-001): dos endpoints internos nuevos, GET /internal/users/:id/kyc-status y GET /internal/payments/mp-connect/:userId/status, consultados en paralelo. Si cualquiera no responde, el bloqueo falla cerrado (502), mismo criterio que el bloqueo de usuarios en escrituras (DD-026).

<span class="dd-etq">Consecuencias</span>


**Trade-offs:** • Se pierde el transportista sin vehículo propio (el caso que MOVO-142 quería cubrir).

  - Dos llamadas síncronas más por escritura de transportista: si svc-users o svc-payments están caídos, nadie puede declarar viajes ni ofertar (falla cerrado).
  - Perder la cuenta de MP a mitad de un viaje en curso no se trata acá (regla de negocio sin definir, fuera del alcance de MOVO-116): solo se revalida al iniciar el viaje y al aceptar una oferta. El hold de MOVO-209 sigue revalidando al cobrar.
  - Hoy nada escribe revoked\_at (MOVO-243), así que el único motivo real de "cuenta no vigente", además de no haber vinculado, es el vencimiento del token.

<span class="dd-etq">Requisitos sumados después</span>


Detalle: • no\_open\_dispute (MOVO-278, DD-045): ningún envío en disputed como transportista. Va primero en missingRequirements y responde 403 CARRIER\_DISPUTE\_OPEN. Es una consulta local (misma DB) y falla cerrado igual que los otros dos. Se levanta cuando se resuelve la disputa (MOVO-34).

  - no\_overdue\_debt (MOVO-313, DD-044): ninguna deuda de la cuenta corriente sin saldar hace más de USER\_DEBT\_OVERDUE\_DAYS (14, env var de svc-shipments). Responde 403 USER\_DEBT\_OVERDUE y va al final de missingRequirements: es lo último que se resuelve (con un pago) y, como la disputa, no es un paso de la checklist de MOVO-117.
  - La deuda es de la persona, el bloqueo es del rol: solo corta las operaciones de transportista de arriba. Como emisor no se bloquea (crear envíos, pagar, aceptar ofertas): su próximo pago ya incluye la deuda (MOVO-311), así que se cobra ahí.
  - Umbral por antigüedad, sin monto mínimo: balanceArs \> 0 y oldestUnpaidAt hace más de 14 días (\> estricto). Quien sigue operando con tarjeta la salda sola; el bloqueo apunta a quien no lo hace por esa vía (efectivo, MOVO-37).
  - Mismo trato que los otros requisitos: consulta síncrona sin cache a GET /internal/payments/users/:userId/balance (MOVO-309), en el mismo Promise.all, y falla cerrado con 502 si svc-payments no responde. Al saldarla (MOVO-311/312) el bloqueo se levanta en la siguiente consulta. No corta envíos en curso: ni el handshake ni el tracking pasan por este gate.
  - Un saldo positivo sin oldestUnpaidAt (solo pasa si lo compone un movimiento ya settled sin contrapartida) bloquea: no se puede probar que la deuda es reciente y no se puede deber plata y operar como si nada. Se levanta al compensar el saldo.
  - Consecuencias por usar la misma función: el emisor que intenta aceptar la oferta de un transportista con deuda vencida recibe el 409 OFFER\_CARRIER\_NOT\_ELIGIBLE sin detalle (igual que con la licencia o una disputa). Es a propósito: el emisor solo se entera de que ese transportista no puede tomar el envío, no del motivo; la deuda es privada del transportista.
  - Viajes recurrentes (DD-042): la deuda frena la ocurrencia, no corta la serie. Si lo único que falta es no\_overdue\_debt (cuenta activa, identidad aprobada), el barrido posterga la generación (deferred, log trip\_recurrence\_generation\_blocked\_by\_debt) y la serie queda intacta. Se avisa al transportista una sola vez por ocurrencia frenada (tripRecurrenceBlockedByDebt: "no pudimos declarar tu próximo viaje porque tenés una deuda pendiente"). Al saldar, la próxima corrida declara la siguiente ocurrencia (sale de max(departureAt, ahora), no nace vencida ni se acumulan atrasadas). Con cualquier otro requisito faltante además de la deuda, la serie se corta como antes.

**Referencias:** MOVO-116 (este ticket), MOVO-117 (UI de requisitos pendientes), MOVO-142 (decisión que se revierte), MOVO-15 (licencia), MOVO-111/112 (vinculación de MP), MOVO-209 (hold), DD-026 (criterio de fallar cerrado).

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

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-275)</p>

Complementa DD-027 (elegir otro receptor tras un rechazo) sin modificarlo.

<span class="dd-etq">Contexto</span>


Una vez que el receptor aceptó un envío, y sobre todo con el paquete viajando, no había forma de cambiar quién lo recibe. DD-027 resuelve otro caso: el emisor elige otra persona después de un rechazo, antes del retiro, volviendo el envío a awaiting\_receiver\_confirmation. Acá lo inicia el receptor, sobre un envío que ya aceptó, y puede pasar en tránsito.

<span class="dd-etq">Decisión</span>


1\. Entidad propia, no un estado del envío. shipments.receiver\_transfer\_requests ( pending\_new\_receiver → completed , con rejected\_by\_new\_receiver , expired y cancelled como cierres alternativos). La transferencia corre en paralelo y nunca toca Shipment.status : con el paquete en tránsito, volver a esperar confirmación rompería el tracking (MOVO-251) y la máquina de estados. Al aceptar, en una sola transacción la solicitud pasa a completed y el envío cambia de receiverId (compare-and-swap contra el receptor que la pidió y un estado que todavía la admite).

2\. La persona invitada tiene que aceptar y tener KYC aprobado, sin bloqueo con el emisor (DD-026). No puede ser el receptor actual, el emisor ni el transportista.

3\. El emisor no aprueba. Se evaluó exigir su aprobación (paga y eligió al receptor, y sería una defensa ante una cuenta de receptor comprometida). Se descartó por la fricción: si el emisor tarda, la transferencia llega tarde para quien no va a estar. Mitigación: KYC y aceptación de la persona invitada, push informativa al emisor en el momento y todo queda en la línea de tiempo como evidencia para una disputa (MOVO-30).

4\. El receptor original conserva acceso de solo lectura (decisión del equipo, distinta de DD-027, donde quien rechazó pierde el acceso). Sigue viendo el detalle, la línea de tiempo, las fotos y el tracking en vivo, y el envío sigue en su lista con el badge “Transferido”. No tiene ninguna acción: no firma la entrega, no califica, no puede volver a transferir. Se implementa en hasShipmentAccess (lectura); los asserts de acción siguen mirando el receiverId vigente.

5\. Una sola transferencia efectiva por envío. Solo la completada consume el cupo. A lo sumo una pendiente y una completada por envío, garantizado por índices únicos parciales.

6\. Plazo y carrera con la entrega. La persona invitada tiene RECEIVER\_TRANSFER\_TIMEOUT\_HOURS (6 h); la vence el mismo barrido que la confirmación del receptor (MOVO-130), y aceptar fuera de plazo da 409 aunque el barrido no haya corrido (pedir otra transferencia también vence inline la pendiente pasada de plazo). La entrega “empieza” cuando el transportista genera el QR de entrega por primera vez: eso deja una marca durable ( shipments.delivery\_handshake\_started\_at , no el QR de Redis, que vence a los 15 s), cancela la solicitud pendiente y desde ahí no se puede pedir ni aceptar un cambio; el UPDATE de receiverId también exige la marca vacía. El handshake siempre valida contra el receiverId vigente.

7\. Línea de tiempo: un item por solicitud. shipment\_events sigue siendo “evento = transición de estado”. Las solicitudes se exponen aparte ( GET /shipments/:id/receiver-transfers , sin cambiar la respuesta de /events ) y el mobile las intercala por fecha como un solo item que cambia según su estado, con texto según quién mira. El emisor y quien pidió cada solicitud ven todas; el transportista y el receptor vigente, solo la completada.

8\. Chat del envío (MOVO-340). Al completarse, el receptor nuevo se suma al chat (ADR-023) en el acto y ve el historial previo : el hilo es uno por envío, es la evidencia de la coordinación y suele tener indicaciones de entrega que le sirven. Lo anterior le cuenta como leído (solo suman como no leídos los mensajes posteriores), y los tildes de un mensaje previo se miden contra los integrantes de ese momento, con el corte en resolved\_at de la transferencia. Los sockets abiertos reciben chat\_participants\_changed ; el receptor original pasa a solo lectura sin que se cierre el suyo, y deja de recibir la push del chat.

<span class="dd-etq">Consecuencias</span>


  - Sin aprobación del emisor, una cuenta de receptor comprometida puede desviar el envío hacia otra persona verificada. Queda la evidencia y la disputa.
  - El receptor original sigue viendo la ubicación del transportista hasta la entrega aunque ya no reciba el paquete (decisión del equipo: le sirve saber que llegó a quien eligió).
  - Dos llamadas a svc-users más al pedir y una al aceptar (perfil y bloqueos), fallando cerrado si no responde.
  - El receptor nuevo lee lo que el original escribió en el chat antes de transferir (por ejemplo, un teléfono). Fue el original quien eligió transferir.
  - Una solicitud pendiente cuenta como actividad de la persona invitada para la baja de cuenta (MOVO-134).

<span class="dd-etq">Referencias</span>


MOVO-275, DD-027 (MOVO-253), DD-026 (MOVO-175), DD-023 (traza GPS), MOVO-130, MOVO-158.

## DD-039 · Tarjetas guardadas del emisor con re-ingreso de CVV

<p class="adr-cab"><span class="chip lime">Propuesto</span> (MOVO-100)</p>

<span class="dd-etq">Contexto</span>


**Situación:** ADR-022 descartó las tarjetas guardadas porque el único intento (spike MOVO-49, 29/09, SOLUCION-FINAL.md §7) falló al guardar la tarjeta en la cuenta de un transportista con 128 "payment method response is empty". La consecuencia de producto es mala: el emisor tiene que escribir número, vencimiento, titular y CVV cada vez que acepta una oferta.

El 13/10/2026 se repitió la prueba contra el sandbox con un Vendedor de prueba vinculado en dev (token TEST-), con un script propio y no el del spike. El 128 no se reprodujo. Lo que se verificó, con Visa y Mastercard de prueba:

Paso | Resultado

Guardar la tarjeta en un customer de la cuenta del Vendedor (POST /v1/customers/{id}/cards) | 201

Re-tokenizar con card\_id + security\_code y la public\_key del Vendedor (POST /v1/card\_tokens) | 201

Crear el hold con ese token, capture:false y application\_fee (POST /v1/payments, token del Vendedor) | 201, authorized / pending\_capture (los dos holds se cancelaron: cancelled / by\_collector)

Control: re-tokenizar sin CVV y crear el hold | Visa: 500 internal\_error. Mastercard: 400 3031 "security\_code\_id can't be null"

Conclusiones firmes: (1) guardar la tarjeta y pagar con solo el CVV funciona con el hold y el split de ADR-022; (2) pagar sin CVV no es posible, así que el cobro automático sin el emisor (la opción B original de MOVO-12) sigue descartado.

No se verificó: que application\_fee efectivamente se aplique (la consulta posterior devolvió fee\_details vacío; lo comprueba la captura, MOVO-212), ni el comportamiento días después, ni más de un Vendedor.

**Alcance:** Revisa el punto 5 de ADR-022 ("el hold se crea siempre con el emisor presente, sin tarjetas guardadas") solo en lo que dice de tarjetas guardadas: el emisor sigue presente en cada pago, pero ya no re-ingresa todos los datos. ADR-022 no se modifica (un ADR aceptado no se edita); este lo reemplaza en ese punto una vez que pase a "aceptado".; Actualización 13/10/2026: la ubicación de la tarjeta (opción A, cuenta de Movo) quedó validada en sandbox con un token TEST- de Movo S.A. (ver "Dónde vive la tarjeta"). Falta confirmar en producción y los puntos de "Pasos para cerrar" antes de pasar a "aceptado".

<span class="dd-etq">Decisión</span>


**Decisión tomada:** 1. El emisor puede guardar tarjetas y, al pagar, solo re-ingresa el CVV. El CVV nunca se guarda: el mobile lo usa para pedir a MP un token de un solo uso (card\_id + CVV + public\_key correspondiente) y lo manda como hoy a POST /shipments/:id/funding. El contrato de svc-shipments y svc-payments no cambia: ya recibe un cardToken.

2\. Lo que se persiste de la tarjeta es solo customer\_id + card\_id de MP más los metadatos de display (marca, últimos 4, vencimiento y un nombre de referencia opcional que elige el usuario). Nunca el card\_token (de un solo uso, vence a los 7 días) ni número ni CVV.

3\. Dueño de la entidad: movo-svc-payments, no svc-users como decía MOVO-100. Es el único servicio que habla con MP (ADR-022) y quien alta/baja la tarjeta tiene que llamar a la API de Customers & Cards; ponerla en svc-users obligaría a svc-users a conocer a MP o a hacer un hop extra por cada operación.

4\. Ubicación de la tarjeta: la cuenta de Movo S.A. (opción A), un customer por emisor, creado con el token TEST-/producción de la app y no con el de ningún transportista. El customer\_id y el card\_id se guardan en svc-payments; el payer del hold es ese customer.

5\. El pago en efectivo del transportista (MOVO-37/101) sigue siendo un caso aparte, con Movo como cobrador directo, sin split. Comparte con este ADR el modelo de datos de tarjeta guardada pero no la ubicación (esa sí es la cuenta de Movo por definición).

<span class="dd-etq">Consecuencias</span>


**Trade-offs:** • Cumplimiento (PCI): no cambia. Número y CVV se capturan y tokenizan en el dispositivo contra MP; el backend nunca los ve. Se suma que se guardan identificadores de MP (customer\_id, card\_id), no datos de tarjeta.

  - El CVV sigue siendo obligatorio en cada pago: sin él MP no crea el hold. El emisor no puede pagar "en segundo plano" y el hold de un retiro lejano sigue requiriendo que abra la app (MOVO-12, DD-021).
  - Más superficie: pantalla de alta/baja de tarjetas, endpoints y una entidad nueva, a cambio de un pago de un paso (elegir tarjeta + CVV).
  - Baja de tarjeta: no se puede borrar una tarjeta con un hold vivo asociado a un envío del emisor. Si MP rechaza la baja o hay un hold vivo, la app muestra el motivo.
  - Tarjetas vencidas o dadas de baja del lado del emisor/banco: la re-tokenización falla y el pago cae al formulario completo (misma pantalla de MOVO-269).
  - El sandbox no refleja del todo producción en este tema (credenciales live de la app): parte de la validación queda para producción, igual que la homologación del modelo Marketplace (ADR-022).

<span class="dd-etq">Dónde vive la tarjeta</span>


Detalle: En la primera prueba el customer y la tarjeta se crearon con el access\_token del Vendedor, es decir en la cuenta del transportista. Eso no sirve para el modelo que se quiere (guardar tarjetas en Ajustes → Pagos y cobros y pedir solo el CVV al aceptar una oferta): en Ajustes no hay transportista, y cada oferta puede venir de uno distinto. La alternativa es guardar la tarjeta en la cuenta de Movo S.A. (un customer por emisor) y derivar de ahí un token por transportista.

Por qué parecía imposible y no lo era. El spike había dado 401 300 "Unauthorized use of live credentials" al crear el customer con la app. La causa no era que Movo S.A. sea una cuenta de prueba, sino que se usaba el token de la app (APP\_USR-…), que MP trata como producción. Pidiendo un token con POST /oauth/token (grant\_type=client\_credentials, test\_token=true) Movo obtiene un token TEST- y puede crear customers (201). Con test\_token=false se reproduce el 300.

Verificado el 13/10/2026 (opción A):

Paso | Resultado

Token TEST- de Movo S.A. (client\_credentials + test\_token:true) | 200, TEST-

Crear el customer del emisor en la cuenta de Movo | 201

Guardar la tarjeta en ese customer (token de la tarjeta generado con una public\_key TEST-) | 201 (visa)

Re-tokenizar con card\_id de la cuenta de Movo + CVV y la public\_key del Vendedor A | 201

Hold con el access\_token del Vendedor A, payer: {type: "customer", id: \<customer de Movo\>}, capture:false + application\_fee | 201, authorized / pending\_capture (cancelado después)

Mismo hold con payer: {email} en vez del customer | 400 2002 "Customer not found": el pagador tiene que ser el customer de la tarjeta

Re-tokenizar con la public\_key del Vendedor B | 201 (el hold de B no se probó: sin sus credenciales)

Detalles que condicionan la implementación:

  - Tokenizar la tarjeta con el Bearer de Movo (sin public\_key) da 403 G001; hace falta una public\_key TEST- en sandbox. La public\_key APP\_USR- de la app genera un token que el customer TEST- no reconoce (404 card not found). En producción se espera usar la public\_key de Movo.
  - El payer del hold debe ser { type: "customer", id }, por lo que payerEmail solo no alcanza: hay que guardar el customer\_id por emisor.

|  |  |  |
| :-: | :-: | :-: |
| \*\*Opción\*\* | \*\*Cómo funciona\*\* | \*\*Estado\*\* |
| A. Tarjeta en la cuenta de Movo (un customer por emisor), token por transportista derivado de ella | Ajustes guarda la tarjeta una vez; al aceptar una oferta se pide el token al transportista con card\\\_id + CVV | Validada en sandbox con el Vendedor A. Falta el hold de otro Vendedor (B) y confirmar en producción |
| B. card\\\_id de la cuenta del Vendedor A con la public\\\_key de B | Una tarjeta guardada en una sola cuenta de transportista | Descartada: A resuelve el problema de raíz |
| C. Tarjeta por transportista | Ingresar la tarjeta completa la primera vez con cada transportista | Validada pero sin valor para el emisor; queda como respaldo si A fallara en producción |

  

<span class="dd-etq">Pasos para cerrar la decisión</span>


Detalle: 1. Crear el hold con las credenciales de un segundo Vendedor (B) usando la misma tarjeta guardada en la cuenta de Movo (hoy solo se probó con A; el token de B se emite, falta el hold).

2\. Repetir el recorrido en producción con una cuenta real y bajo monto: la public\_key y el token de Movo son distintos fuera del sandbox, y la homologación del modelo Marketplace sigue pendiente (ADR-022).

3\. Confirmar que application\_fee se aplica al capturar (MOVO-212).

4\. Con eso, pasar el ADR a "aceptado". Si falla en producción, la alternativa es la opción C.

<span class="dd-etq">Referencias</span>


**Referencias:** • docs/payments/adr-022-arquitectura-de-cobro.md (punto 5 y alternativas)

  - docs/payments/mercadopago-spike/SOLUCION-FINAL.md §7
  - docs/payments/flujo-de-pagos.md §7
  - Tickets: MOVO-65, MOVO-100, MOVO-101, MOVO-12, MOVO-269, MOVO-37, MOVO-49, MOVO-212

## DD-041 · Pricing por peso facturable con distancia achatada

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-276)</p>

<span class="dd-etq">Contexto</span>


**Situación:** demand\_fuel\_routes\_v1 casi no usaba el paquete para cotizar: el peso entraba lineal y barato (\~300 $/kg) y el volumen no entraba. Un televisor de 105 × 65 × 15 cm costaba apenas más que una caja de zapatos, y un cubo de 1 m³ lo mismo que una caja compacta de 10 kg. La distancia ya se había achatado con un hotfix (tramos decrecientes, 10/10/2026) pero esa curva nunca se había documentado ni calibrado contra una referencia.

Correo Argentino, Andreani, OCA y Mercado Envíos cotizan con el mismo modelo, aunque sus números no sean públicos: peso facturable (máximo entre real y volumétrico, L × A × H / 5000), distancia por zonas, tramos de peso y límites duros de peso y medidas.

**Alcance:** Reemplaza la parte de cálculo de ADR-021 (demand\_fuel\_routes\_v1); combustible, recargo por demanda, fallback a Haversine × 1,3 y contrato de /quote siguen como los dejó ADR-021.

<span class="dd-etq">Alternativas consideradas</span>


**Alternativa 1:** Forma del achatamiento de la distancia

**Alternativa 2:** Zonas escalonadas (lo que hace la industria): fácil de explicar, pero el precio salta en los bordes de cada zona (un km más puede costar un 20% más) y MOVO no tiene una matriz de zonas por código postal. Descartada.

**Alternativa 3:** Curva cóncava (ej. raíz o logaritmo de la distancia): suave, pero difícil de explicar en la defensa y de calibrar contra una referencia por tramos. Descartada.

**Alternativa 4:** Tramos de km con tarifa marginal decreciente (elegida): continua, monótona y cóncava por construcción, y cada parámetro se lee como "cuánto cuesta un km más en este tramo".

Base del precio

**Alternativa 5:** Desvío marginal del transportista como base (cobrar lo que le cuesta desviarse): exigiría un precio por transportista, distinto del que vio el emisor, y chocaría con la cotización congelada de DD-028. Descartada: el desvío se informa al transportista y él lo traduce en su oferta.

Frágil: categoría o atributo

**Alternativa 6:** Convertir frágil en un booleano combinable con la categoría separaría tamaño de manipulación ("un frasco y un televisor frágiles no deberían costar lo mismo"), pero cambia el modelo de datos del envío y el wizard mobile. Con el peso facturable el tamaño ya entra en el precio de un fragile\_item, así que el problema que motivaba el cambio desaparece sin migrar nada. Se mantiene como categoría.

Límites duros

**Alternativa 7:** Andreani acepta 50 kg reales y 300 cm de suma de lados (165 cm por lado). Se tomó la suma de 300 cm pero 30 kg y 150 cm por lado: el transportista de MOVO es una persona en su auto, no un camión de reparto, y 30 kg/150 cm ya eran los máximos que validaba el schema del envío desde MOVO-80.

**Alternativa 8:** Límites según el vehículo del transportista (una moto no carga lo que un auto): queda fuera; el límite es del paquete. Lo que el transportista no puede llevar lo resuelve no ofertando.

<span class="dd-etq">Decisión</span>


**Decisión tomada:** 1. Método nuevo package\_tapered\_v2 (PriceCalculationMethod, @movo/shared y Python). Los envíos ya creados conservan su precio congelado y su método (demand\_fuel\_routes\_v1 o euclidean\_linear\_v1): nada recalcula un precio persistido (MOVO-82 AC8, MOVO-255).

2\. Peso facturable = máx(peso real, L × A × H / PRICING\_VOLUMETRIC\_DIVISOR), divisor 5000 por default (Correo/Andreani/OCA; Mercado Libre usa 6000). Los primeros PRICING\_WEIGHT\_TIER\_KG (10) se cobran a tarifa llena y el resto al PRICING\_WEIGHT\_TIER\_RATE (35%): sin ese tramo, el cubo de 1 m³ que admiten los límites (200 kg volumétricos) cotizaba \~$135.000 a cualquier destino.

3\. Distancia: se conservan los tramos de km del hotfix (primeros 30 km al 100%, hasta 300 km al 20%, el resto al 1,5%), ahora formalizados y calibrados.

4\. Categoría: letter\_document tiene una tarifa base propia y menor (PRICING\_BASE\_FARE\_DOCUMENT\_L); fragile\_item lleva un recargo porcentual (PRICING\_FRAGILE\_SURCHARGE, 20%) sobre el mismo paquete no frágil.

5\. Un solo precio sugerido, origen → destino, calculado al cotizar y congelado con el quoteId. El desvío marginal del transportista (MOVO-219) se muestra, no se cobra.

6\. Límites duros: 30 kg reales, 150 cm por lado y 300 cm de suma de lados (PACKAGE\_MAX\_\*, mismas env vars y defaults en svc-shipments y svc-pricing-logistics). svc-shipments los valida al cotizar y al crear el envío (422 PACKAGE\_LIMITS\_EXCEEDED con details.violations) antes de cualquier I/O, y /quote responde 422 con el mismo criterio como defensa.

7\. Coeficientes en litros de nafta (como en ADR-021), calibrados con una grilla de referencia: para standard\_package de hasta 10 kg facturables en rutas de 200 km o más, el precio cae entre 0,6× y 1,0× del Correo clásico a domicilio. La grilla (docs/pricing/grilla-referencia.md, tests/pricing\_grid.py) queda como golden tests del motor, con 100% de cobertura exigida en CI sobre los módulos de pricing.

<span class="dd-etq">Consecuencias</span>


**Trade-offs:** • El documento a larga distancia sigue siendo caro (\~$15.500 a 1.500 km, más que 1 kg por Correo): su precio es casi todo distancia y una base menor no alcanza. Corregirlo exigiría una tarifa por km por categoría; queda para recalibrar con datos reales.

  - La caja de zapatos a CABA queda en 0,99× del Correo, al borde del techo de la banda. Con la distancia real de Google (menor que la del mock de la grilla) el cociente baja, pero cualquier recalibración tiene que volver a pasar los golden tests.
  - La banda solo cubre standard\_package de hasta 10 kg facturables en rutas de 200 km o más: el Correo no publica tramos mayores ni sirve de referencia para envíos urbanos (ahí la competencia es la mensajería en moto). El resto queda cubierto solo por las propiedades de forma: monotonía en distancia y peso facturable, y concavidad en distancia.
  - Las medidas siguen siendo las que declara el emisor: quien subdeclara paga menos. No hay verificación más allá de las fotos del retiro.
  - Los límites se configuran en dos servicios: si se recalibran, hay que cambiarlos en los dos (y el mobile replica 150 cm por lado y 300 cm de suma para el aviso en línea; el 422 del backend sigue siendo la fuente de verdad).

**Referencias:** MOVO-276, MOVO-138/ADR-021, MOVO-216 (spike), MOVO-219 (desvío marginal), MOVO-255/DD-028 (cotización congelada), MOVO-82/DD-018.

## DD-042 · Viajes recurrentes: recurrencia como atributo del Trip con generación de la siguiente ocurrencia

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-264, spike)</p>

Implementación en MOVO-265 (svc-shipments) y MOVO-266 (movo-mobile). El ticket reservaba DD-029 (lo tomó MOVO-260) y después DD-041 (lo tomó MOVO-276), así que queda 042.

<span class="dd-etq">Contexto</span>


El PO pide viajes recurrentes (“todos los viernes viajo a Villa María”). Hoy un Trip es un viaje con una fecha concreta, y varias piezas dependen de eso: las ofertas aceptadas, el filtro de matching por día de departureAt (MOVO-163), el barrido de vencimiento (MOVO-238/DD-032), el cierre a completed y el índice de un solo viaje active por transportista. Por eso un Trip no puede representar “todos los viernes” en una sola fila.

<span class="dd-etq">Alternativas consideradas</span>


Entidad TripSchedule + job que materializa trips con N días de anticipación. Cubre más casos (por ejemplo, matchear paquetes de dentro de dos semanas), pero suma una entidad, un job nuevo y el problema de “editar la serie o solo esta ocurrencia”. Para el alcance del TFG no compensa.

<span class="dd-etq">Decisión</span>


1\. Un trip por ocurrencia, generados de a uno. La recurrencia es un atributo del propio Trip : recurrenceWeekdays ( int\[\] , valores 0-6, nullable = no recurrente), recurrenceUntil ( date , nullable, inclusive, interpretada en America/Argentina/Cordoba ) y seriesId ( uuid ; el primer trip de la serie usa su propio id). Cuando pasa el departureAt del trip vigente, el sistema genera solo la ocurrencia siguiente como un Trip común en declared . La genera sin importar cómo termine el vigente ( declared todavía sin vencer, active , expired , cancelled , completed ).

2\. Convención de días: 0 = domingo … 6 = sábado , como getDay() de JS y EXTRACT(DOW) de Postgres. Se fija como constante documentada en @movo/shared . El mobile ordena los chips arrancando en lunes, pero el mapeo nunca depende de la posición.

3\. Trip vigente e idempotencia por sucesor. El trip generado guarda generatedFromTripId ( uuid , FK a Trip , UNIQUE ): cada trip tiene a lo sumo un sucesor. El “trip vigente” de una serie es el que nadie referencia. Se descartó el índice único parcial “un solo trip no terminal por seriesId ”: cuando el vigente pasa a active y se genera el siguiente en declared , los dos son legítimos a la vez. El insert usa ON CONFLICT DO NOTHING , así que una segunda corrida del barrido o dos instancias en paralelo no duplican, y no hace falta un nextGeneratedAt . Como el candidato se lee antes de dos llamadas HTTP por serie, el insert bloquea la fila origen ( FOR UPDATE ), la relee como cabeza de una serie activa y copia los datos de esa fila: un PATCH / cancel con stopRecurrence que llegó en el medio gana y no se genera nada (review de PR \#246). La API expone isSeriesHead para que el mobile no tenga que reconstruir la cadena.

4\. Cuándo y dónde se genera. Es un paso nuevo del barrido existente ( trip-expiry-sweep.ts , runStep propio), sin job nuevo. Corre después de cancel\_overdue\_declared , así el vigente que vence en esa misma corrida ya cuenta como expired para la regla de serie fantasma (punto 8).

5\. Fecha de la siguiente ocurrencia. Es el próximo día de recurrenceWeekdays estrictamente posterior a max(departureAt, now) , a la misma hora de pared, calculado en America/Argentina/Cordoba con el helper de @movo/shared/utils/argentina-date (el mismo huso que canStartTripOn , DD-034). Nunca se suman 7×24 h en UTC. Tomar el máximo con now evita una cascada de trips que nacen vencidos si el barrido estuvo caído varios días. Si la fecha supera recurrenceUntil , no se genera nada y la serie termina sola. El trip generado copia ruta, vehicleType , la recurrencia y seriesId .

6\. Editar. La recurrencia solo se edita en el trip vigente (en otro trip de la serie responde 409 TRIP\_NOT\_SERIES\_HEAD ). Editar el vigente (ruta, hora, días) define el patrón de las ocurrencias siguientes: no hay una edición “de la serie” aparte. Un viaje con paquetes aceptados no se edita (409 TRIP\_HAS\_ACCEPTED\_PACKAGES ), tampoco su recurrencia: si el transportista quiere otro patrón, declara un viaje nuevo. La única excepción es apagar la recurrencia ( recurrenceWeekdays: null , con o sin recurrenceUntil: null ), que no cambia ese viaje concreto y es la única forma de cortar una serie cuyo vigente ya tiene paquetes (review de PR \#246: la primera versión dejaba pasar cualquier PATCH de solo recurrencia, y entonces cambiar los días de un vigente ya active chocaba con la regla del día de salida de abajo, pensada para un viaje que todavía se puede editar). Validaciones: al menos un día, sin repetidos; el día de semana de departureAt (huso Córdoba) tiene que estar en recurrenceWeekdays ; recurrenceUntil tiene que ser posterior a la fecha de departureAt . Prender o cambiar la recurrencia exige que el viaje esté declared o active (409 TRIP\_NOT\_EDITABLE si ya terminó: un expired / cancelled / completed sin sucesor sería candidato del barrido y se declararía uno nuevo desde el historial). Un trip auto-creado por MOVO-234 se puede volver recurrente con PATCH , como cualquier otro.

7\. Cancelar la ocurrencia o cortar la serie. POST /trips/:id/cancel (MOVO-260) suma { stopRecurrence?: boolean } . Sin el flag cancela solo la ocurrencia, y la siguiente se genera igual cuando pasa su departureAt . Con true también apaga la recurrencia, en la misma transacción. Sobre un trip no recurrente o que no es vigente, el flag se ignora. El cancel sigue limitado a viajes declared sin paquetes aceptados ( TRIP\_NOT\_DECLARED / TRIP\_HAS\_ACCEPTED\_PACKAGES ), así que la elección “solo este / este y dejar de repetir” del mobile solo aparece ahí. Para cortar una serie cuyo vigente ya tiene paquetes, está “Dejar de repetir” (el PATCH que la apaga, única excepción del punto 6). Apagar la recurrencia ( recurrenceWeekdays = null ) conserva seriesId como histórico.

8\. Cortes automáticos (siempre recurrenceWeekdays = null en el vigente + push):

  - Serie fantasma: si las últimas 3 ocurrencias consecutivas de la cadena ( generatedFromTripId ) terminaron expired , no se genera la siguiente. Cuenta cualquier expired , sea un declared vencido o un active que se quedó sin paquetes: las dos rutas significan “el viaje no llevó nada” y no hay un startedAt que permita distinguirlas. Una cancelled por el usuario no cuenta y corta la racha.

El resto de esta decisión (los demás cortes automáticos, la alternativa descartada y las consecuencias completas) está en el repositorio: docs/shipments/dd-042-viajes-recurrentes.md.

Trade-off aceptado: Solo existe la próxima ocurrencia, así que no se matchean paquetes a 2 o más semanas. La hora sale del viaje vigente y, si ya tiene paquetes aceptados, ni la hora ni los días se pueden cambiar (solo se puede apagar la serie). Un problema temporal de requisitos al correr el barrido apaga la serie, porque no hay un disparador para saltear y reintentar. No hay control de solapamiento, igual que POST /trips.

## DD-043 · Refresh idempotente del panel en una ventana de 10 segundos

<p class="adr-cab"><span class="chip lime">Propuesto</span> · pendiente de aceptación en Sprint 0</p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Refresh idempotente del panel durante 10 s con la misma clave y el mismo token, coordinado en Redis y con resultado cifrado (MOVO-291). Conserva el reuso fuera de ventana y la política de la app.

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: Es una excepción acotada a la rotación estricta, pensada para solicitudes concurrentes de Next. Queda pendiente de aceptación en Sprint 0.

Fuente: fila de resumen del registro de decisiones del repositorio (docs/decisiones/README.md); texto completo en docs/auth/dd-043-refresh-idempotente-panel.md.

## DD-044 · Cuenta corriente del usuario

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-309, 15/10/2026)</p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Cuenta corriente por usuario (no por rol), en payments.user\_ledger\_entries, con saldo con signo (positivo = debe, negativo = a favor); el saldo es la suma de lo que no está voided. Es de solo inserción, impuesta por triggers (de un UPDATE solo pasa status), e idempotente por idempotencyKey más el hash del cuerpo. Incluye oldestUnpaidAt para el bloqueo por deuda (MOVO-313). Es la base de las penalidades (MOVO-226) y de la comisión en efectivo (MOVO-37).

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: La plata de las penalidades cobradas como deuda queda para Movo, sin crédito al emisor perjudicado. El signo no se deduce del tipo: lo manda quien registra. La deuda se cobra en el application\_fee del próximo hold (MOVO-311, tope del 30 % del precio, con una reserva negativa que un trigger anula si el hold se cae) o con un pago voluntario (MOVO-312).

Fuente: fila de resumen del registro de decisiones del repositorio (docs/decisiones/README.md); texto completo en docs/payments/dd-044-cuenta-corriente-del-usuario.md.

## DD-045 · Salida para un envío in\_transit demorado: aviso, disputa automática y bloqueo del transportista

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-278)</p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Complementa DD-032 sin modificarlo. La marca de anomalía de tránsito se expone (transitAnomalyFlaggedAt; “Demorado” en la app y “No tenemos la ubicación del transportista” en el mapa). A las 12 h de la marca se avisa al transportista (una sola vez) y a las 24 h el barrido pasa el envío a disputed sin actor, lo que cierra el viaje solo. Se suma a DD-036 el requisito no\_open\_dispute (403 CARRIER\_DISPUTE\_OPEN). Los plazos se configuran por variables de entorno.

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: El transportista con una disputa abierta queda bloqueado sin salida hasta MOVO-34. La disputa no toca el hold, que puede vencer sin reintento de captura (riesgo conocido: el cobro posterior a la resolución va por la cuenta corriente de MOVO-309). “Demorado” no promete una revisión que hoy nadie hace.

Fuente: fila de resumen del registro de decisiones del repositorio (docs/decisiones/README.md); texto completo en docs/shipments/dd-045-salida-in-transit-demorado.md.

## DD-046 · Notificaciones push del chat con el texto y ráfagas en un resumen (MOVO-301)

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-301)</p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Las notificaciones push del chat llevan nombre, rol y texto (140 caracteres), al estilo WhatsApp; reemplaza el punto “push sin el texto” de ADR-023. El primer mensaje avisa enseguida y los que llegan en los 30 s siguientes se juntan en un único resumen que sale al cerrarse la ventana, se omite si ya se leyó y vuelve a filtrar bloqueos y envío al salir. El mobile saca de la bandeja las notificaciones del chat al abrirlo.

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: El texto se ve en la pantalla bloqueada. No hay reemplazo de notificaciones (Expo Push no lo permite), así que una ráfaga son hasta dos avisos por ventana. El resumen vive en un setTimeout del proceso y un reinicio lo pierde.

Fuente: fila de resumen del registro de decisiones del repositorio (docs/decisiones/README.md); texto completo en docs/chat/dd-046-notificaciones-de-chat.md.

## DD-047 · Penalidad por cancelar un envío asignado

<p class="adr-cab"><span class="chip lime">Propuesto</span> (MOVO-307, 15/10/2026)</p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Si se cancela un envío assigned con menos de 12 h hasta el inicio de la ventana de retiro acordada y la ventana abierta, se cobra el 25 % del precio acordado; con 12 h o más, o con la ventana cerrada, es sin cargo. La regla es única y vive en @movo/shared (computeCancellationPenalty), y el emisor confirma el monto que vio (409 CANCELLATION\_PENALTY\_MISMATCH si cambió). Primero se cancela y después se cobra: deuda en la cuenta corriente (DD-044) más captura parcial del hold (MOVO-306); si el hold no la soporta, se libera entero y queda como deuda. Desde MOVO-310 los mismos tramos aplican al transportista que se baja de un envío asignado (POST /shipments/:id/carrier-withdrawal): el envío vuelve a published y la penalidad va como deuda a su cuenta corriente.

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: Mercado Pago cobra el application\_fee entero en la captura parcial (spike MOVO-305), por lo que el transportista recibe cerca del 11 % del precio y no el 25 %. Con el plan B (incluido un hold con deuda previa) o con el hold vencido, la penalidad se cobra después (MOVO-311) y no compensa al transportista.

Fuente: fila de resumen del registro de decisiones del repositorio (docs/decisiones/README.md); texto completo en docs/payments/dd-047-penalidad-de-cancelacion.md.

## DD-048 · Cuenta cobradora de Movo configurada por credenciales

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-315, 17/10/2026)</p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** “Pagar mi saldo” cobra con las credenciales de la propia cuenta de Mercado Pago de Movo S.A. (MP\_COLLECTOR\_ACCESS\_TOKEN y las claves asociadas), sin un usuario interno de Movo ni OAuth en la app; reemplaza la cobradora vinculada a un usuario de MOVO-312. En producción se usan las credenciales productivas del panel; en sandbox, el token TEST- del OAuth de la cuenta de prueba (scripts/collector-oauth.mjs), que es el único que cobra con tarjeta.

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: En dev el token vence a los 180 días y se renueva a mano. Dev y prod cobran con distinto tipo de credencial, y producción no se puede probar en el sandbox (queda para MOVO-283).

Fuente: fila de resumen del registro de decisiones del repositorio (docs/decisiones/README.md); texto completo en docs/payments/dd-048-cuenta-cobradora-de-movo.md.

## DD-049 · Sanciones de cuenta: suspended y banned

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-296)</p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** AccountStatus.suspended bloquea las operaciones pero no el login, y banned pasa a significar inhabilitada (corta el login). El historial vive en users.account\_sanctions (solo altas y cierre, una vigente por usuario) y User.status/bannedUntil son la caché de la vigente; una suspensión vencida se lee como active. El gateway lee una clave Redis account:restriction:\<userId\> (suspended o disabled) con TTL hasta el fin de la suspensión; Redis no es la fuente de verdad: svc-users la reescribe al arrancar y en un barrido periódico que también cierra las suspensiones vencidas. Los avisos de sanción no se pueden silenciar desde las preferencias.

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: Las marcas pueden quedar desfasadas hasta el próximo barrido (5 min por defecto) si Redis falla justo después del commit. Una suspensión pausa (no apaga) las series recurrentes.

Fuente: fila de resumen del registro de decisiones del repositorio (docs/decisiones/README.md); no tiene borrador extendido.

## DD-050 · Plazo del hold de Mercado Pago (5 días) y N de la saga (3 días)

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-215)</p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Complementa ADR-022. MP\_HOLD\_VALIDITY\_DAYS = 5 (el mínimo documentado por MP; el sandbox no venció dos holds en unas 188 h, así que la medición no permite subirlo) y FUNDING\_NEAR\_PICKUP\_DAYS = 3, de modo que N + tránsito máximo no supere el plazo del hold (2 días entre retiro y vencimiento, uno de tránsito y uno de margen). Ambos valores son configuración.

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: El plazo no está confirmado en producción ni por banco emisor, y solo se midió Visa crédito. El status\_detail de un hold vencido que asume MOVO-268 sigue sin confirmarse. Con N = 3, más envíos van por la ruta lejana.

Fuente: fila de resumen del registro de decisiones del repositorio (docs/decisiones/README.md); texto completo en docs/payments/dd-050-plazo-del-hold.md.

## DD-051 · Soporte al usuario sobre el chat existente (MOVO-320)

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-320)</p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Las consultas de soporte viven en movo-svc-shipments (support\_conversations, support\_messages, support\_participant\_states) y reusan el ChatHub con otra clave de sala (support:\<id\>), el handshake WS, el filtro de lenguaje y la push de DD-046 (con categoría propia support). Las notas internas del equipo no llegan al usuario por ningún camino: un único punto (toUserFacingMessage) arma lo que ve y la consulta usa una lista blanca de kind. Escribir sobre una conversación resolved la reabre; un envío ajeno es 422 SUPPORT\_SHIPMENT\_NOT\_PARTY y una consulta ajena es 404. No hay borrado ni archivo al resolver.

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: Es una excepción más a “un esquema por servicio” (ADR-003). El registro de sockets está en memoria y en una réplica (ADR-006/019). El plazo de retención de las conversaciones queda por definir con el equipo legal (MOVO-224) y no hay job de purga. El lado del agente es MOVO-322.

Fuente: fila de resumen del registro de decisiones del repositorio (docs/decisiones/README.md); texto completo en docs/support/dd-051-soporte-al-usuario.md.

## DD-052 · Atribución del no-retiro con evidencia GPS pasiva

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-270)</p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Complementa DD-023/ADR-020, DD-032, DD-045 y DD-047 sin modificarlos. Cada posición de un envío assigned con el viaje activo se clasifica contra el punto de retiro (llegada, lejos o zona gris, según la distancia menos la precisión) y se guarda en shipments.pickup\_evidence, sin guardar la traza. El barrido de retiro no realizado atribuye: si el transportista no llegó, se cancela con attribution: carrier y la penalidad de baja de DD-047 como deuda; si llegó sin handshake, el envío pasa de assigned a disputed con el hold liberado y sin bloquear al transportista; sin evidencia, se cancela sin culpables. El emisor que cancela con la ventana cerrada y la llegada registrada paga el 25 %. Pasado el plazo del barrido, el retiro ya no se confirma.

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: La falta de datos nunca culpa a nadie: con mala señal o el pin mal geocodificado, un transportista que llegó puede quedar “sin evidencia”. iOS no informa mocked. El emisor no se trackea (por eso su falta va a disputa y no a cobro). La penalidad es plata para Movo y la disputa sigue sin salida hasta MOVO-34.

Fuente: fila de resumen del registro de decisiones del repositorio (docs/decisiones/README.md); texto completo en docs/shipments/dd-052-atribucion-del-no-retiro.md.

## DD-053 · Oferta de transportistas del recargo por demanda: solo viajes declared

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-270)</p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Ajusta el insumo de ADR-021 (DD-041 no cambia el recargo): countAvailableCarriersNear cuenta solo viajes declared, porque un viaje active ya no toma paquetes (DD-032). El umbral ((publicados + 1) / transportistas ≥ 3, mínimo 4) queda igual, y v2 aplica el mismo multiplicador sobre su subtotal.

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: Las ocurrencias autogeneradas de viajes recurrentes (DD-042) y los transportistas inhabilitados (MOVO-313, MOVO-278) siguen contando: filtrarlos exigiría consultar otros servicios en cada cotización.

Fuente: fila de resumen del registro de decisiones del repositorio (docs/decisiones/README.md); texto completo en docs/pricing/dd-053-conteo-de-oferta.md.

## DD-054 · Disputa sobre un envío completed: la arista completed → disputed

<p class="adr-cab"><span class="chip lime">Aceptado</span> (MOVO-334)</p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Complementa DD-021 y DD-045. Se agrega la arista completed → disputed, porque el handshake de entrega captura el hold y pasa el envío a completed en el momento (MOVO-212), y delivered → disputed casi nunca se alcanza. La usa solo una de las partes dentro de los 7 días desde deliveredAt (DISPUTE\_WINDOW\_DAYS, la misma ventana que para delivered), nunca un barrido, y abrirla no toca la plata. Mientras dure, el envío deja de contar como cumplido (reputación, ranking, historial compartido, calificación). La disputa es una entidad (shipments.disputes) creada en la misma transacción, una abierta por envío.

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: Con el cobro ya acreditado no hay hold que liberar: recuperar la plata queda para MOVO-337 (cuenta corriente, DD-044). La reputación baja temporalmente aunque la disputa se resuelva a favor del transportista.

Fuente: fila de resumen del registro de decisiones del repositorio (docs/decisiones/README.md); texto completo en docs/shipments/dd-054-disputa-desde-completed.md.

## DD-055 · Cambio forzado de estado de un envío desde el panel

<p class="adr-cab"><span class="chip lime">Propuesto</span> (MOVO-330/331)</p>

<span class="dd-etq">Decisión</span>


**Decisión tomada:** Complementa DD-021, ADR-022, DD-044, DD-045, DD-047 y DD-054. Una matriz FORCED\_TRANSITION\_MATRIX en @movo/shared es la fuente de verdad (el panel solo la lee) y POST /internal/admin/shipments/:id/force-status ejecuta el servicio de dominio de cada celda, nunca un UPDATE. Solo se usan aristas que ya existen; la cancelación y la baja hechas por un admin condonan la penalidad; pasar a assigned exige un hold autorizado en payments; disputed, completed, cancelled, in\_transit y delivered no se fuerzan. Lleva expectedStatus obligatorio (409), lock por envío e idempotencyKey; el evento registra el tipo (manual o forced) y al admin, y las partes no ven ni su identidad ni el motivo. Se envía un aviso crítico a las tres partes.

<span class="dd-etq">Consecuencias</span>


Trade-off aceptado: Un envío in\_transit o disputed trabado sigue sin salida por el panel (el primero necesita una decisión sobre evidencia, el segundo es MOVO-34). Los avisos críticos saltan las preferencias del usuario.

Fuente: fila de resumen del registro de decisiones del repositorio (docs/decisiones/README.md); texto completo en docs/shipments/dd-055-cambio-forzado-de-estado.md.
