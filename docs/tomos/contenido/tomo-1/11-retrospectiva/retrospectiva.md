# El Proyecto en Cifras

Antes de la reflexión, un resumen del recorrido. El equipo trabajó en sprints de dos semanas con Scrum, estimando en Story Points con Planning Poker y usando Linear como fuente de verdad de las métricas. La evolución sprint a sprint (velocity, issues y foco de cada uno) está en el Resumen del Proceso de la sección de Informes de Sprint; acá se recoge solo lo que ayuda a leer la reflexión.

Funcionan de punta a punta, en sandbox, el onboarding con KYC, la publicación de envíos, el marketplace de ofertas, el viaje declarado con matching por desvío marginal, la ruta optimizada multi-parada, el handshake criptográfico con QR y evidencia fotográfica, el seguimiento en vivo, la reputación, el chat, el cobro con retención, captura y split, las penalidades de cancelación y el panel de administración. Documentamos 55 decisiones técnicas: 23 ADRs que fijan el stack, los proveedores, la estructura entre servicios y el modelo de seguridad, y 32 decisiones de diseño en un registro aparte. La suite de `movo-svc-shipments` llegó a 1118 tests con 92% de cobertura. En la Feria de Proyectos de octubre, Movo quedó entre los tres finalistas de la categoría Mejor Producto.

Lo que todavía no está validado es el cobro con dinero real en producción y varias verificaciones en dispositivo físico y en el entorno desplegado.

Para armar este documento cruzamos los Informes de Sprint, el Plan de Proyecto, el documento de Sprint 0 (Working Agreement y ADRs), el Registro de Decisiones de Diseño, los ciclos y comentarios de Linear y el repositorio de GitHub. Las cifras salen de esas fuentes; las conclusiones son nuestras.

# Tres Decisiones que Resultaron Bien

## Validar contra los sistemas reales, no contra la documentación ni contra mocks

Tomamos como regla probar las integraciones contra el sandbox real del proveedor y la base de datos real antes de cerrar un diseño. Fue la decisión que más problemas nos evitó:

- El *spike* de Didit.me (MOVO-48) mostró que los estados reales del webhook no coincidían con los asumidos en los criterios de aceptación; se corrigió en el mismo sprint agregando `manual_review` al dominio.
- El *spike* de OR-Tools VRPTW (MOVO-50) se resolvió en dos días con datos de prueba, lo que bajó temprano uno de los riesgos técnicos más altos del Plan de Proyecto.
- Probando con Twilio real aparecieron problemas de autenticación y de formato de números argentinos (+549 frente a +54) que ningún mock iba a mostrar.
- Ejecutar a propósito dos confirmaciones del handshake en paralelo contra Postgres real encontró una condición de carrera que ningún test secuencial hubiera detectado.
- En pagos, el *spike* de captura parcial (MOVO-305) y la prueba de tarjetas guardadas (MOVO-100) descubrieron que el CVV es obligatorio y que el `application_fee` se cobra entero en una captura parcial. Ninguna de las dos cosas estaba en la documentación de Mercado Pago, y las dos cambiaron el modelo de datos antes de escribir la migración.

**Por qué funcionó:** un error de contrato con un tercero descubierto en un *spike* cuesta horas; descubierto después de implementar y conectar el móvil, cuesta un sprint. Además, un *spike* con prueba de concepto ejecutable (como el del canal WebSocket, MOVO-200) permitió implementar la tarea siguiente sin volver a discutir la decisión.

## Aislar cada proveedor externo detrás de una interfaz con implementación simulada por defecto

Desde temprano cada dependencia externa quedó detrás de una interfaz propia: SMS (Twilio), email (Resend), geocodificación y rutas (Google), identidad (Didit.me) y pagos. En desarrollo, pruebas e integración continua corre una implementación determinística, y el proveedor real se activa por variable de entorno. Lo mismo aplicamos en el dominio: el estado `assigned_unfunded` y la liberación de fondos detrás de una interfaz sin efecto permitieron construir todo el circuito operativo mientras Mercado Pago estuvo bloqueado. Y cuando una funcionalidad dependía de algo que todavía no existía, la bloqueamos explícitamente con un error de negocio en lugar de simularla (por ejemplo, la cancelación con penalidad respondía 409 hasta que hubo retenciones reales, MOVO-29).

**Por qué funcionó:** cinco personas pudimos avanzar en paralelo sin credenciales cargadas ni cuotas de API consumidas, la integración continua nunca dependió de un servicio externo y, cuando se destrabó Mercado Pago, el resto del sistema ya estaba listo para enchufarle el cobro. Eso explica que el frente de pagos completo (31 issues, 89 SP) se haya podido cerrar en un solo sprint. La contracara fue que algunas verificaciones contra el servicio real quedaron postergadas (ver la sección 11.3.3).

## Documentar las decisiones en el momento y no reescribir lo ya acordado

Adoptamos tres prácticas que sostuvimos todo el año: registrar cada decisión técnica con su contexto, alternativas y trade-offs (con su resumen de una línea en el repositorio); comentarios de cierre en Linear que explican lo que no sale del diff (desvíos respecto del ticket, pendientes, cómo se probó); y la convención de no editar en silencio un criterio de aceptación ya aceptado: se abre un ticket nuevo que referencia y reemplaza al anterior (por ejemplo MOVO-91, MOVO-95, o el ADR-013, que reemplazó el TTL del ADR-004).

**Por qué funcionó:** dio trazabilidad real entre historia, decisión, código y prueba, que es lo que pide la cátedra y lo que hizo posible escribir informes de sprint detallados a partir de las fuentes. También ayudó a que el trabajo fuera transversal: cualquiera podía tomar un ticket de otro dominio y entender por qué estaba hecho así. Y permitió detectar contradicciones antes de programar, como en MOVO-158, donde el criterio original pedía que el backend firmara con una clave que por diseño nunca sale del dispositivo.

# Tres Cosas que Haríamos Diferente

## Proteger el compromiso del sprint frente al scope que entra a mitad de ciclo

Salvo en el Sprint 1, que fue de infraestructura y tuvo el scope estable, en todos los sprints el scope creció entre un 89% y un 425% después de la Planning. En la mayoría igual cerramos el 100% del scope final, pero eso escondió el problema: nunca pudimos comparar de forma honesta lo planificado con lo logrado, y en el Sprint 5 el crecimiento (+237%) terminó en 38 SP arrastrados, concentrados mayormente en una persona. En varios sprints entraron frentes completos sin pasar por la Planning. El *action item* de registrar por qué se sumaba cada ticket, o de no sumar sin retirar su equivalente, apareció en casi todas las retrospectivas desde el Sprint 2 y nunca se cumplió.

**Qué haríamos:** acordar desde el Sprint 0 una regla simple y aplicarla en el tablero, no solo en el Working Agreement: a mitad de ciclo entran solo bugs y derivados directos de un ticket en curso; todo frente nuevo espera a la próxima Planning. También definiríamos desde el inicio una capacidad en Story Points (el Plan solo la tenía en horas) para que las alertas de velocity tuvieran una referencia real.

## Ponerle plazo a un bloqueo externo y atacarlo con un *spike* propio

En el Sprint 3, el *spike* de Mercado Pago (MOVO-49) validó la retención, la captura y la vinculación por OAuth, pero el split payment combinado con la retención falló con el error 2034 en las nueve variantes que probamos. Abrimos un ticket de soporte el 13 de agosto y cerramos el *spike* como Done con ese criterio sin resolver, lo que dio una falsa sensación de progreso. Durante más de 45 días esperamos la respuesta del soporte, y el *action item* de escalar o definir un plan B no se cumplió en los dos sprints siguientes. El bloqueo se resolvió el 29 de septiembre, no por el soporte sino probando otra configuración de cuentas de prueba (una app creada desde una cuenta de tipo Marketplace). Mientras tanto, el frente de pagos acumuló más de 14 tickets sin iniciar y quedó concentrado en un solo integrante.

**Qué haríamos:** no cerrar un *spike* como Done si su criterio más riesgoso quedó bloqueado, y fijar un plazo (por ejemplo, una semana) después del cual un bloqueo externo deja de esperarse y se ataca con un *spike* propio con dos personas asignadas. En un frente crítico como pagos, además, repartiríamos el conocimiento desde el principio en lugar de cuando el bloqueo ya está resuelto. Lo vimos funcionar al revés más adelante: con el frente repartido entre los cinco, se cerró completo en dos semanas.

## Convertir los acuerdos transversales en tickets con un responsable

Las tareas que no pertenecían a ninguna historia fueron las que más se arrastraron. El caso más claro fueron los ADRs: durante casi todo el año estuvieron divididos entre el repositorio y el documento de Sprint 0, con numeraciones distintas entre ambas fuentes y colisiones de número. Además, como no habíamos definido qué merecía un ADR, llegamos a más de 50, muchos de ellos reglas de un solo módulo. Lo resolvimos recién al final: fijamos un criterio (es ADR solo si define el stack, un proveedor o una integración, la estructura entre servicios o el modelo de seguridad), dejamos 23 ADRs y pasamos las otras 32 decisiones al Registro de Decisiones de Diseño, que conserva su número original para no romper las referencias viejas (el detalle está en el Tomo II). Funcionó, pero tardamos seis sprints en hacerlo, y mientras el repositorio siga recibiendo decisiones nuevas, las dos fuentes necesitan un paso de sincronización.

Pasó algo parecido con otros acuerdos. El DER del proyecto en Drive dejó de reflejar el modelo real y la fuente actualizada pasó a ser el DBML del repositorio. Las verificaciones en dispositivo físico y en el entorno desplegado (canal WebSocket en EC2, handshake entre dos teléfonos, mapa en Android, *deep-links*) quedaron declaradas como «pendientes» en cada ticket y sin dueño. Y en dos ocasiones se publicaron credenciales en texto plano en tickets de Linear, en contra de nuestra propia política de información sensible.

**Qué haríamos:** lo resumimos en una lección que el propio equipo escribió en un Informe de Sprint: un *action item* sin un ticket en Linear ni un responsable único no se cumple. Cada acuerdo transversal tendría que ser un issue con fecha. Para la documentación, definiríamos en el Sprint 0 el criterio de qué es un ADR y qué es una decisión de diseño, elegiríamos una única fuente de verdad (la del repositorio, que se actualiza en cada PR) y reservaríamos el número al abrir el ticket. Para las verificaciones reales, sumaríamos al Definition of Done de las historias que dependen de infraestructura o hardware un paso de prueba en entorno desplegado o dispositivo físico.

# Recomendaciones para Futuros Equipos con Proyectos Similares

Lo que le diríamos a un equipo que arranque un producto propio con microservicios e integraciones con terceros:

- **Hagan los *spikes* de proveedores externos en los primeros sprints, contra el sandbox real.** El de Didit.me lo pospusimos hasta último momento y nos costó retrabajo; el de captura parcial lo hicimos antes de implementar y nos ahorró un rediseño. La documentación de los proveedores no alcanza.
- **Desconfíen del sandbox también.** El de Mercado Pago respondió error 500 a todos los pagos durante tres días en pleno sprint de pagos. Prueben contra el proveedor al principio del ticket, no al final.
- **Pongan cada tercero detrás de una interfaz con un mock por defecto**, pero importen los tipos de una librería compartida: cuando el móvil definió sus propios tipos contra un mock, el contrato terminó divergiendo del backend.
- **Definan la regla de scope antes de necesitarla** (sección 11.3.1) y estimen o excluyan de la velocity el tiempo académico (feria, documentación) para no distorsionar la serie.
- **Tengan una sola fuente de verdad por artefacto** (sección 11.3.3). ADRs, DER y diagramas: elijan dónde viven y que el resto sea un enlace, porque dos copias se desincronizan siempre.
- **Midan lo que pasa, no solo lo que se etiqueta.** Nuestro Defect Rate dio 0 en sprints con bugs reales porque se corregían dentro de otro ticket sin etiqueta. Si un defecto se corrige, merece su issue aunque se cierre en el mismo PR.
- **Escriban comentarios de cierre que expliquen el porqué.** Fue lo que más nos sirvió para los informes de sprint, para trabajar en cualquier dominio y para defender las decisiones ante los docentes.
- **Nunca pongan credenciales en tickets, chats ni documentos.** Desde el día uno, un gestor de secretos (en nuestro caso AWS Secrets Manager) como único lugar, y rotación inmediata si alguna se filtra.
- **Usen la IA con revisión humana y reglas claras.** Nos ayudó en revisión de historias, prototipos y relevamiento para los informes, pero las decisiones y las verificaciones siguieron siendo del equipo, como establece la política del Working Agreement.
- **Repartan los frentes críticos entre varias personas** (sección 11.3.2). El conocimiento concentrado en una sola persona fue un riesgo que se materializó en KYC y en pagos; cuando repartimos, el riesgo desapareció y la velocidad subió.

# Cierre

Mirando el año completo, lo que mejor nos salió fue la parte técnica difícil: integraciones con terceros, criptografía, optimización de rutas y pagos con retención quedaron funcionando y documentadas. Lo que más nos costó fue la disciplina de proceso alrededor de eso: proteger el sprint, cumplir los acuerdos que no tenían ticket y mantener la documentación en un solo lugar. La mejora más clara llegó cuando empezamos a cerrar primero lo que estaba en revisión, a repartir los frentes críticos y a dejar de esperar a terceros. Es lo que nos llevamos como equipo.
