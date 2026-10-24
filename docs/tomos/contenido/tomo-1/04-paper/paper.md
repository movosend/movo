<div class="paper-cab">
<p class="paper-titulo">Movo</p>
<p class="paper-subtitulo">Sistema de Logística P2P</p>
<p class="paper-autores">Ariza, Alena · Bordino Blanche, Juan Cruz · Dalmagro, Lucas · Vergara, Tomás Ignacio · Yorlano, Pedro</p>
<p class="paper-inst"><em>Universidad Tecnológica Nacional, Facultad Regional Córdoba</em></p>
</div>

## Abstract {.unnumbered}

*El proyecto abordó el problema de la exclusión logística en Argentina, donde la infraestructura de los operadores formales se concentra en centros urbanos y los costos de envío frecuentemente superan el valor del objeto transportado. Por ello se desarrolló Movo, una plataforma de logística distribuida peer-to-peer que conecta a personas que necesitan enviar un paquete con personas que ya realizan ese recorrido. El principal obstáculo identificado no fue tecnológico sino de confianza: las alternativas informales existentes carecen de verificación de identidad, trazabilidad y garantías de pago. Se adoptó una metodología ágil iterativa (Scrum/Kanban), y se diseñó una arquitectura de microservicios sobre la que se implementaron cuatro capas de confianza: verificación de identidad mediante KYC biométrico delegado, un protocolo de transferencia de custodia basado en criptografía asimétrica y validación de proximidad por GPS, un esquema de pagos con retención y liberación diferida de fondos, y un sistema de reputación bidireccional. Se incorporó además un motor de precios dinámico y un algoritmo de optimización de rutas derivado del Vehicle Routing Problem with Time Windows. Se concluyó que es posible sustituir al intermediario centralizado por un conjunto de mecanismos verificables basados en tecnologías innovadoras.*

**Palabras clave:** logística P2P; economía colaborativa; verificación de identidad; transferencia de custodia; optimización de rutas (VRPTW); split payment; sistema de reputación; producto.

## Introducción {.unnumbered}

Enviar un paquete entre dos localidades del interior del país puede costar más que el objeto que se transporta. Los grandes operadores logísticos concentran su infraestructura en zonas de alta densidad poblacional, y la cobertura en localidades chicas es limitada, intermitente o inexistente.

Esas vías informales existen y funcionan a escala. Grupos de WhatsApp, publicaciones en Facebook Marketplace y redes de contactos personales resuelven cientos de envíos diarios. El problema es que operan sin ninguna garantía: no hay verificación de identidad, no hay trazabilidad del paquete, no hay mecanismo de pago seguro y no existe instancia de resolución de conflictos. El riesgo se asume individualmente y sin contrato.

Existe entonces una asimetría estructural. Por un lado, capacidad de transporte ociosa: personas que ya realizan un recorrido y podrían llevar un paquete sin costo marginal de combustible. Por otro lado, la demanda insatisfecha de envíos. Lo que falta entre ambas puntas no es infraestructura física sino un mecanismo de confianza.

Las plataformas de economía colaborativa resuelven este problema convirtiéndose ellas mismas en el garante: la empresa centraliza la identidad, el pago y el arbitraje.

El problema que aborda este trabajo es, entonces, si es posible coordinar una red logística entre desconocidos sin que exista un tercero que garantice la transacción, reemplazando la confianza institucional por evidencia técnica. El objetivo consiste en diseñar e implementar una plataforma que permita a cualquier persona enviar un paquete a través de otra persona que ya realiza ese recorrido, con seguridad verificable sobre el traspaso, el pago y la identidad de las partes.

## Elementos del Trabajo y Metodología {.unnumbered}

El equipo adoptó una metodología ágil bajo el marco de trabajo Scrum (a diferencia de marcos predictivos como los del PMI, PMBOK, que no se ajustan a un alcance que se fue validando de forma iterativa), con sprints de dos semanas, estimación mediante Planning Poker y seguimiento de velocidad de desarrollo (*velocity*), tiempo de entrega (*lead time*) y cumplimiento del objetivo del sprint (*sprint goal achievement*). El código se gestionó en un monorepo en GitHub, con integración continua vía GitHub Actions. Como apoyo al desarrollo y a la documentación se emplearon herramientas de inteligencia artificial bajo una política de uso acordada por el equipo, que exige la revisión humana de todo contenido generado [9].

Se optó por una arquitectura de microservicios comunicados a través de un API Gateway. Los servicios de identidad, envíos, pagos y administración se implementaron en Node.js con Fastify [1] sobre TypeScript. El servicio de precios y logística se implementó en Python con FastAPI, por la disponibilidad de Google OR-Tools [2]. La persistencia se resolvió con PostgreSQL [3] para datos transaccionales y Redis [4] para sesiones y estado de tiempo real. La aplicación móvil se desarrolló en React Native con Expo, desplegando el backend sobre AWS EC2 mediante Docker Compose [5].

## Resultados {.unnumbered}

El sistema quedó operativo como aplicación móvil para iOS y Android, respaldada por un backend de microservicios desplegado en AWS. El problema de confianza identificado en la introducción se abordó mediante cuatro mecanismos independientes: verificación de identidad delegada a Didit [6], un proveedor externo de KYC biométrico; un protocolo de transferencia de custodia basado en criptografía asimétrica y proximidad por GPS; un esquema de retención y liberación diferida de fondos; y un sistema de reputación bidireccional. A continuación se describen las funcionalidades principales entregadas.

**Transferencia de custodia.** Fue la funcionalidad de mayor complejidad del proyecto. Al retirar y al entregar el paquete, ambos dispositivos confirmaron su identidad y su cercanía física mediante un código QR de vigencia breve, y el sistema validó automáticamente que el intercambio fuera legítimo antes de liberar los fondos. Cualquier intento inválido (fuera de tiempo, fuera de rango o sin autenticar) fue rechazado y notificado a ambas partes. El mismo mecanismo se aplicó en el retiro y en la entrega, generando una cadena de custodia verificable de punta a punta.

**Optimización logística.** El motor calculó, a partir de la ruta declarada por el transportista y los envíos compatibles, usando Google OR-Tools [2] sobre matrices de distancia de la Routes API de Google Maps Platform [7], la secuencia de paradas que minimizaba el desvío respetando las ventanas horarias comprometidas con cada emisor.

**Motor de precios y ofertas.** El sistema calculó una tarifa de referencia a partir de la distancia, el peso facturable y la categoría del paquete, con recargos por combustible y por demanda en la zona, sobre la cual los transportistas disponibles compitieron con sus propias ofertas.

**Pagos.** El ciclo de autorización, retención, captura y distribución se implementó sobre los mecanismos de *Auth & Capture* y *Split Payments* de Mercado Pago [8]. Los fondos del emisor se reservaron al asignarse el envío y se capturaron al confirmarse la entrega. El split transfirió el importe al transportista y la comisión a la plataforma en una sola operación, sin que Movo procesara fondos ajenos a su ingreso. La modalidad de pago en efectivo, en la que la comisión se cobraría automáticamente contra un medio de pago precargado del transportista, quedó diseñada y se plantea como trabajo futuro.

**Seguimiento y evidencia.** Emisor y receptor pudieron visualizar la posición del transportista sobre un mapa interactivo, actualizada en tiempo real mediante WebSockets. El sistema exigió registro fotográfico del paquete en la solicitud, el retiro y la entrega.

## Discusión {.unnumbered}

Los resultados sugieren que la sustitución de un intermediario centralizado por un conjunto de mecanismos técnicos verificables es viable en el contexto de la logística P2P.

Sin embargo, conviene delimitar el alcance de esa garantía. El protocolo prueba que dos dispositivos con claves privadas registradas estuvieron a menos del umbral de distancia en un instante determinado y que uno de ellos firmó un desafío emitido por el backend. No prueba que el paquete entregado sea el mismo que fue retirado ni que su contenido esté intacto. Esa dimensión se cubre parcialmente con evidencia fotográfica en los puntos de traspaso. El protocolo tampoco resiste un pacto o acuerdo secreto e ilegal entre transportista y receptor, dado que ambos pueden encontrarse físicamente sin que el paquete haya sido efectivamente transportado. Lo que el sistema hace es elevar significativamente el costo del fraude y dejar registro auditable, no eliminarlo.

De modo análogo, el registro de eventos de custodia se almacena junto con el hash del desafío firmado en una base de datos relacional bajo control de la plataforma. Es verificable e íntegro frente a corrupción accidental, pero no inmutable en sentido estricto: un operador con acceso a la base podría alterarlo. Se descarta deliberadamente el uso de una blockchain pública, cuyo costo operativo y latencia resultan desproporcionados frente al beneficio marginal en este caso de uso.

La dependencia de una única instancia de PostgreSQL y de un único host EC2 constituye un punto único de fallo. El *trade-off* se acepta conscientemente en función del alcance del proyecto y se mitiga con snapshots automáticos, pero una puesta en producción real exigiría replicación y orquestación distribuida.

Finalmente, la aceptación de la plataforma opera en tensión directa con el crecimiento de la red. Un sistema P2P sin masa crítica de transportistas no tiene valor para los emisores, lo que constituye una barrera real.

## Conclusión {.unnumbered}

Movo se consolida como una solución tecnológica que permite resolver la exclusión logística, aprovechando la capacidad de transporte ya existente y con foco en las personas y la seguridad.

Los objetivos planteados en la introducción se alcanzan: el protocolo de transferencia de custodia produce evidencia verificable del cambio de posesión, el motor logístico reduce el desvío del transportista respecto de su ruta declarada, y el esquema de pagos alinea los incentivos económicos de las tres partes sin que la plataforma procese fondos ajenos a su comisión.

Como líneas de trabajo futuro, el sistema podría evolucionar incorporando la modalidad de pago en efectivo, enriqueciendo el motor de precios con series históricas de demanda, incorporando replicación de base de datos y orquestación distribuida para eliminar el punto único de fallo señalado en la discusión, y sumando nuevas modalidades de transporte a medida que crezca la red de transportistas.

## Agradecimientos {.unnumbered}

A la Universidad Tecnológica Nacional, Facultad Regional Córdoba, por la formación académica de excelencia durante todos estos años, y a la Ing. Cecilia Trettel, cuya dedicación, guía y paciencia fueron fundamentales para concretar este proyecto. Con mucha emoción, dedicamos este logro a nuestras familias; gracias por su apoyo incondicional y por los sacrificios que sostuvieron nuestra carrera: este título es tan suyo como nuestro. Por último, gracias a nuestros amigos de «Popu el byte del fondo» por ser compañía, por las risas compartidas y por hacer de estos años universitarios una experiencia verdaderamente inolvidable.

## Referencias {.unnumbered}

1. Fastify. «Fastify Documentation». <https://fastify.dev/docs/latest/> (julio de 2026).
2. Google for Developers. «OR-Tools: Vehicle Routing». <https://developers.google.com/optimization/routing> (julio de 2026).
3. The PostgreSQL Global Development Group. «PostgreSQL 16 Documentation». <https://www.postgresql.org/docs/16/> (julio de 2026).
4. Redis Ltd. «Redis Documentation». <https://redis.io/docs/latest/> (julio de 2026).
5. Docker Inc. «Docker Compose Documentation». <https://docs.docker.com/compose/> (julio de 2026).
6. Didit. «Didit Documentation». <https://docs.didit.me/> (julio de 2026).
7. Google for Developers. «Google Maps Platform: Routes API, Compute Route Matrix». <https://developers.google.com/maps/documentation/routes> (octubre de 2026).
8. Mercado Pago Developers. «Split Payments: documentación de integración Marketplace». <https://www.mercadopago.com.ar/developers/es/docs/split-payments/landing> (julio de 2026).
9. Anthropic. (2026). *Claude* [Modelo de lenguaje de gran tamaño]. <https://claude.ai/> (agosto de 2026).

## Datos de contacto {.unnumbered}

Ariza, Alena: arizaalena@gmail.com · Bordino Blanche, Juan Cruz: juancruzbordino@gmail.com · Dalmagro, Lucas: lucasdalmagro1@gmail.com · Vergara, Tomás Ignacio: tivergara@outlook.com · Yorlano, Pedro: pedro.yorlano@gmail.com

::: nota
**Cambios respecto de la versión presentada en la jornada (agosto de 2026).** Se actualizaron las afirmaciones técnicas que el desarrollo posterior modificó: (1) la matriz de distancias usa la Routes API de Google (ADR-015) en lugar de la Distance Matrix API, y la referencia [7] se actualizó en consecuencia; la cita de OR-Tools pasó a la referencia [2]; (2) los fondos se reservan al *asignar* el envío (no al retirarlo); (3) el motor de precios dejó de ser provisorio y la modalidad de pago en efectivo, que el texto original daba por implementada, pasó a trabajo futuro; (4) se precisó que el registro de custodia guarda el hash del desafío firmado; (5) se agregó la mención del uso de IA con su cita [9], que figuraba en las referencias pero no se citaba en el texto. El resto del contenido se conserva sin cambios.
:::
