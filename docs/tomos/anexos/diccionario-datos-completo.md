# Modelo de Datos y Diccionario Completo

El modelo de datos relacional vive en una única instancia de PostgreSQL 16 con **un esquema por microservicio** (ADR-003). Cada servicio define su esquema con Prisma (ADR-011) y es el único que lo lee y escribe: las referencias entre esquemas (por ejemplo, el emisor de un envío o el pagador de un hold) son **referencias lógicas por identificador, sin clave foránea real**, de modo que ningún servicio depende de las tablas de otro. Los diagramas y el diccionario de este documento se generan directamente de los archivos `schema.prisma`, por lo que reflejan el estado real del código.

En total el modelo comprende **53 tablas** y **650 columnas** en cuatro esquemas.

En los diagramas, `*` marca una columna obligatoria, `PK` la clave primaria y `FK` una clave foránea. Por legibilidad cada entidad muestra su clave, sus claves foráneas y las columnas más relevantes. El inventario siguiente destaca campos clave; el diccionario completo de columnas se conserva como anexo digital en `docs/tomos/anexos/diccionario-datos-completo.md`. Las entidades de otro grupo que se referencian por clave foránea aparecen solo con su clave.

## Identidad (esquema `users`)

El esquema contiene 16 tablas y 11 tipos enumerados.

![DER: Cuenta, roles, direcciones y vehículo.](diagrama:der-users-cuenta){.borde .sin-corte}

![DER: Verificación de identidad, licencia y sanciones.](diagrama:der-users-verificacion){.borde .sin-corte}

![DER: Notificaciones y recorridos.](diagrama:der-users-notificaciones){.borde .sin-corte}

![DER: Reportes y bloqueos entre usuarios.](diagrama:der-users-moderacion){.borde .sin-corte}

### Tablas

::: {.tabla-der-inventario}

| Tabla | Propósito | Campos clave |
|----------------|----------------------------------------|----------------------------------------|
| `device_keys` | par de claves asimétricas por dispositivo, prerrequisito del handshake criptográfico de MOVO-6 (implementado en `svc-shipments`, ticket hermano MOVO-158). | `id`, `user_id` |
| `vehicle_profiles` | ficha de vehículo del transportista, mostrada en el perfil público (`PublicProfile.vehicle`) para que quien entrega su paquete pueda verificar el vehículo antes de subirlo. | `id`, `user_id` |
| `notification_preferences` | toggle maestro de push + "Horario de silencio" (quiet hours), 1 fila por usuario (mismo patrón `userId @unique` que `DeviceKey`/`VehicleProfile` -- un upsert sobre la misma fila, sin… | `id`, `user_id` |
| `notification_category_preferences` | tabla SPARSE a propósito -- una fila solo cuando el usuario tocó el toggle de esa categoría. | `id`, `user_id` |
| `user_tour` | registro de los tours del tutorial in-app, un upsert por (usuario, tour). | `user_id` |
| `user_blocks` | una fila por dirección (quién bloqueó a quién), pero el EFECTO es simétrico -- `listRelatedUserIds` une las dos direcciones. | `id`, `blocker_id`, `blocked_id` |
| `user_reports` | solo se persiste -- la revisión (pending -> reviewed/dismissed) queda para el panel de admin, fuera de alcance de esta US. Se conserva tras la baja de cuenta de cualquiera de las dos… | `id`, `reporter_id`, `reported_id`, `reason`, `status` |
| `user_report_entries` | información que el reportante suma a su reporte pendiente. | `id`, `report_id` |
| `user_report_photos` | fotos de evidencia de un reporte. | `id`, `report_id`, `entry_id` |
| `users` | – | `id`, `email`, `phone`, `phone_verified`, `email_verified`, `email_verified_at`, `status` |
| `user_roles` | – | `user_id`, `role` |
| `kyc_verification` | tabla `KYC_VERIFICATION` del DER ("tiene intentos de", 1 a N desde User). | `id`, `user_id`, `verification_type`, `external_session_id`, `status` |
| `address` | tabla `address` del DER (docs/movo_der.dbml), diseñada como patrón de libreta de direcciones (1:N desde User, con label/is_default). | `id`, `user_id` |
| `push_token` | registro de push token por dispositivo (AC1) -- un usuario puede tener N dispositivos, cada uno con un solo token vigente (índice único (user_id, device_id), permite multi-dispositivo). | `id`, `user_id` |
| `drivers_license` | tabla `drivers_license` del DER (docs/movo_der.dbml) -- el registro del carnet en sí, distinto de `kyc_verification` (que es el log de intentos, 1 a N). | `id`, `user_id`, `kyc_verification_id`, `status` |
| `account_sanctions` | historial de sanciones de cuenta. | `id`, `user_id`, `type`, `reason`, `lift_reason` |

: Tablas del esquema `users`.

:::

### Tipos enumerados

| Tipo | Valores |
|------------------------------|----------------------------------------------------|
| `UserRole` | `sender`, `carrier`, `admin` |
| `KycStatus` | `not_started`, `pending`, `approved`, `rejected`, `expired`, `manual_review` |
| `VerificationType` | `identity`, `license` |
| `DriversLicenseStatus` | `pending`, `verified`, `expired` |
| `AccountStatus` | `active`, `banned`, `deleted`, `suspended` |
| `AccountSanctionType` | `suspension`, `disable` |
| `AccountSanctionClosedCause` | `lifted`, `replaced`, `escalated`, `expired` |
| `PushPlatform` | `ios`, `android` |
| `TourOutcome` | `completed`, `skipped` |
| `ReportReason` | `harassment`, `no_show`, `damaged_package`, `payment_issue`, `other` |
| `ReportStatus` | `pending`, `reviewed`, `dismissed` |

: Enumerados del esquema `users`.

### Diccionario de datos completo

#### `device_keys`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `user_id` | uuid | FK → `users`, único, no nulo |  |
| `public_key` | text | no nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `device_keys`.

#### `vehicle_profiles`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `user_id` | uuid | FK → `users`, único, no nulo |  |
| `brand` | text | no nulo |  |
| `model` | text | no nulo |  |
| `cargo_capacity_label` | text | no nulo |  |
| `license_plate` | text | no nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `vehicle_profiles`.

#### `notification_preferences`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `user_id` | uuid | FK → `users`, único, no nulo |  |
| `push_enabled` | bool | no nulo, por defecto true |  |
| `quiet_hours_enabled` | bool | no nulo, por defecto false |  |
| `quiet_hours_from` | text | no nulo, por defecto "23:00" | Hora Argentina "HH:MM" (`toArgentinaTimeOfDayString`/`isWithinQuietHours` de @movo/shared) -- se guarda como texto, no `@db.Time`, porque nunca se… |
| `quiet_hours_to` | text | no nulo, por defecto "08:00" |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `notification_preferences`.

#### `notification_category_preferences`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `user_id` | uuid | FK → `users`, no nulo |  |
| `category` | text | no nulo |  |
| `enabled` | bool | no nulo, por defecto true |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `notification_category_preferences`.

#### `user_tour`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `user_id` | uuid | FK → `users`, no nulo |  |
| `tour_id` | text | no nulo |  |
| `version` | int | no nulo |  |
| `outcome` | enum TourOutcome | no nulo |  |
| `recorded_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `user_tour`.

#### `user_blocks`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `blocker_id` | uuid | FK → `users`, no nulo |  |
| `blocked_id` | uuid | FK → `users`, no nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `user_blocks`.

#### `user_reports`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `reporter_id` | uuid | FK → `users`, no nulo |  |
| `reported_id` | uuid | FK → `users`, no nulo |  |
| `reason` | enum ReportReason | no nulo |  |
| `details` | text | nulo |  |
| `status` | enum ReportStatus | no nulo, por defecto pending |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `user_reports`.

#### `user_report_entries`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `report_id` | uuid | FK → `user_reports`, no nulo |  |
| `details` | text | nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `user_report_entries`.

#### `user_report_photos`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `report_id` | uuid | FK → `user_reports`, no nulo |  |
| `entry_id` | uuid | FK → `user_report_entries`, nulo |  |
| `s3_key` | text | no nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `user_report_photos`.

#### `users`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `email` | text | único, no nulo |  |
| `phone` | text | único, no nulo |  |
| `first_name` | text | no nulo |  |
| `last_name` | text | no nulo |  |
| `password_hash` | text | no nulo |  |
| `dni` | text | nulo |  |
| `bio` | text | nulo | bio de texto libre del perfil, nullable sin backfill -- "" nunca se persiste, se resuelve a null en users.service.ts. |
| `terms_accepted_at` | timestamptz | nulo | "firma electrónica" de aceptación al registrarse. |
| `terms_version` | text | nulo |  |
| `privacy_accepted_at` | timestamptz | nulo |  |
| `privacy_version` | text | nulo |  |
| `phone_verified` | bool | no nulo, por defecto false |  |
| `email_verified` | bool | no nulo, por defecto false | el email pasa a ser un dato verificado (precondición de MOVO-64, recuperación de contraseña por email) y no solo un dato de contacto. |
| `email_verified_at` | timestamptz | nulo |  |
| `photo_url` | text | nulo |  |
| `kyc_status_identity` | enum KycStatus | no nulo, por defecto not_started |  |
| `kyc_status_license` | enum KycStatus | no nulo, por defecto not_started |  |
| `status` | enum AccountStatus | no nulo, por defecto active |  |
| `banned_until` | timestamptz | nulo |  |
| `deleted_at` | timestamptz | nulo | la fija `anonymizeAndDelete`. NULL en las bajas anteriores (sin backfill). |
| `birthdate` | date | nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo | El trigger users.update_updated_at_column() de la migración original ya mantiene esta columna al día en cada UPDATE -- @updatedAt hace que Prisma… |

: Columnas de `users`.

#### `user_roles`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `user_id` | uuid | FK → `users`, no nulo |  |
| `role` | enum UserRole | no nulo |  |
| `granted_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `user_roles`.

#### `kyc_verification`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `user_id` | uuid | FK → `users`, no nulo |  |
| `verification_type` | enum VerificationType | no nulo |  |
| `provider` | text | no nulo |  |
| `external_session_id` | text | único, no nulo | `session_id` de Didit -- único: un intento por sesión, y es la clave con la que el webhook (AC7) encuentra a qué intento corresponde un evento… |
| `status` | enum KycStatus | no nulo |  |
| `requested_at` | timestamptz | no nulo, por defecto now() |  |
| `resolved_at` | timestamptz | nulo |  |
| `raw_decision` | jsonb | nulo | Payload del webhook de Didit REDACTADO (whitelist de campos seguros -- nunca imagen de documento ni dato biométrico, AC9). |

: Columnas de `kyc_verification`.

#### `address`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `user_id` | uuid | FK → `users`, no nulo |  |
| `label` | text | nulo |  |
| `is_default` | bool | no nulo, por defecto false |  |
| `street` | text | no nulo |  |
| `street_number` | text | no nulo |  |
| `floor_apartment` | text | nulo |  |
| `city` | text | no nulo |  |
| `province` | text | no nulo |  |
| `postal_code` | text | no nulo |  |
| `country` | text | no nulo | No se pide en el wizard (la app es solo Argentina hoy, mismo criterio que el regex de teléfono en auth.schema.ts) — se hardcodea "AR" al crear. |
| `lat` | numeric | no nulo | Poblados por el paso de mapa/geocoding del wizard de registro (MOVO-73) — a diferencia del resto de las columnas, el DER no los marca nullable, así… |
| `long` | numeric | no nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `address`.

#### `push_token`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `user_id` | uuid | FK → `users`, no nulo |  |
| `expo_push_token` | text | no nulo |  |
| `device_id` | text | no nulo |  |
| `platform` | enum PushPlatform | no nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `push_token`.

#### `drivers_license`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `user_id` | uuid | FK → `users`, único, no nulo |  |
| `kyc_verification_id` | uuid | FK → `kyc_verification`, no nulo |  |
| `expiration_date` | date | nulo | Fecha de vencimiento impresa en el documento -- extraída de `decision.id_verifications[0].expiration_date` (feature "ID Verification" de Didit,… |
| `status` | enum DriversLicenseStatus | no nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `drivers_license`.

#### `account_sanctions`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `user_id` | uuid | FK → `users`, no nulo |  |
| `type` | enum AccountSanctionType | no nulo |  |
| `reason` | text | no nulo |  |
| `internal_note` | text | nulo |  |
| `started_at` | timestamptz | no nulo, por defecto now() |  |
| `ends_at` | timestamptz | nulo |  |
| `applied_by` | uuid | nulo |  |
| `lifted_at` | timestamptz | nulo |  |
| `lifted_by` | uuid | nulo |  |
| `lift_reason` | text | nulo |  |
| `closed_cause` | enum AccountSanctionClosedCause | nulo |  |

: Columnas de `account_sanctions`.

## Envíos, viajes y soporte (esquema `shipments`)

El esquema contiene 23 tablas y 22 tipos enumerados.

![DER: Envíos, ofertas, eventos y calificaciones.](diagrama:der-shipments-envios){.borde .sin-corte}

![DER: Viajes, custodia y seguimiento.](diagrama:der-shipments-custodia){.borde .sin-corte}

![DER: Chat del envío.](diagrama:der-shipments-chat){.borde .sin-corte}

![DER: Soporte.](diagrama:der-shipments-soporte){.borde .sin-corte}

![DER: Disputas.](diagrama:der-shipments-disputas){.borde .sin-corte}

### Tablas

::: {.tabla-der-inventario}

| Tabla | Propósito | Campos clave |
|----------------|----------------------------------------|----------------------------------------|
| `shipments` | – | `id`, `package_type`, `pickup_address`, `pickup_lat`, `pickup_lng`, `pickup_city`, `delivery_address`, `delivery_lat` |
| `shipment_events` | historial append-only de transiciones — nunca se actualiza ni se borra una fila ya insertada. | `id`, `shipment_id`, `reason` |
| `shipment_photos` | solo la referencia a S3, nunca la imagen (ADR-007). | `id`, `shipment_id` |
| `offers` | hermano de Shipment (MOVO-79/104/105) para la entidad Offer. | `id`, `shipment_id`, `price_offered`, `offered_pickup_time_window_start`, `offered_pickup_time_window_end`, `carrier_rating_at_offer`, `sender_verified_at_offer`, `sender_rating_at_offer` |
| `ratings` | calificación post-entrega de una parte del envío hacia otra. | `id`, `shipment_id`, `role`, `score`, `punctuality_score`, `care_score`, `communication_score` |
| `handshake_events` | log append-only de handshakes de custodia CONFIRMADOS -- nunca se actualiza ni se borra una fila, mismo criterio que ShipmentEvent (sin trigger de DB, por convención de repositorio:… | `id`, `shipment_id` |
| `carrier_positions` | traza de posiciones GPS del transportista durante un envío `in_transit`. Append-only (AC9): ningún código de este servicio hace UPDATE de una fila ya insertada, solo la purga periódica… | `id`, `shipment_id`, `trip_id` |
| `pickup_evidence` | evidencia GPS pasiva del retiro de un envío `assigned`, sin guardar la traza (la traza solo se guarda con custodia, DD-023). | `shipment_id` |
| `trips` | viaje declarado por el transportista para matching geométrico de paquetes compatibles por corredor (MOVO-50) y gestión de rutas ("Mis viajes", MOVO-18/162). | `id`, `vehicle_type`, `status`, `generated_from_trip_id` |
| `pricing_game_sessions` | Juego de precios de la feria (movo-institucional, /juegos/precios): una fila por partida. | `id`, `package_type`, `quote_verified`, `suggested_price_ars` |
| `route_game_sessions` | Juego del optimizador de la feria (movo-institucional /juegos/optimizador): una fila por partida. | `id` |
| `receiver_transfer_requests` | – | `id`, `shipment_id`, `reason`, `response_reason`, `status`, `cancel_reason`, `new_receiver_deadline` |
| `chat_messages` | mensajes del chat de un envío. | `id`, `shipment_id` |
| `chat_participant_states` | hasta dónde recibió y leyó el chat cada integrante de un envío (los tildes del mensaje y el contador de no leídos). | `shipment_id` |
| `chat_reports` | "Reportar conversación". Una por persona y envío; la revisa el equipo de Movo. | `id`, `shipment_id` |
| `support_conversations` | – | `id`, `code_number`, `status`, `shipment_id` |
| `support_messages` | Solo se agregan, nunca se editan ni se borran (evidencia). | `id`, `conversation_id` |
| `support_attachments` | imagen adjunta a un mensaje de soporte (S3 privado, ADR-007). | `id`, `conversation_id`, `message_id`, `s3_key`, `content_type` |
| `support_participant_states` | Hasta dónde recibió y leyó la conversación el usuario (contador de no leídos). | `conversation_id` |
| `user_display_names` | nombre visible de cada usuario que participó de un envío, para el listado y la búsqueda del panel sin depender de svc-users. | `user_id` |
| `disputes` | Una sola disputa `open` por envío: índice único parcial agregado a mano en la migración (`disputes_shipment_open_key`), Prisma no los representa. | `id`, `shipment_id`, `opened_by_role`, `reason`, `status`, `carrier_amount_ars`, `sender_amount_ars`, `reasoning` |
| `dispute_statements` | Descargo de una parte que no abrió (`statement`) o ampliación única de quien abrió (`amendment`). | `id`, `dispute_id`, `author_role` |
| `dispute_photos` | Solo la referencia a S3 (ADR-007). | `id`, `dispute_id`, `statement_id`, `s3_key` |

: Tablas del esquema `shipments`.

:::

### Tipos enumerados

| Tipo | Valores |
|------------------------------|----------------------------------------------------|
| `PackageType` | `letter_document`, `standard_package`, `fragile_item` |
| `ShipmentStatus` | `awaiting_receiver_confirmation`, `rejected_by_receiver`, `published`, `assignment_pending`, `assigned_unfunded`, `assigned`, `in_transit`, `delivered`, `completed`, `cancelled`, `disputed` |
| `PhotoStage` | `creation`, `pickup`, `delivery` |
| `RatingRole` | `sender`, `carrier`, `receiver` |
| `OfferStatus` | `pending`, `accepted`, `rejected`, `withdrawn`, `expired`, `superseded`, `shipment_cancelled`, `assignment_lapsed`, `carrier_withdrawn` |
| `HandshakeStage` | `pickup`, `delivery` |
| `CancellationPenaltyStatus` | `pending`, `captured`, `debt` |
| `TripStatus` | `declared`, `active`, `cancelled`, `expired`, `completed` |
| `ShipmentEventKind` | `normal`, `manual`, `forced` |
| `PickupMissedAttribution` | `carrier`, `none` |
| `PaymentMethod` | `card`, `cash` |
| `ReceiverTransferStatus` | `pending_new_receiver`, `completed`, `rejected_by_new_receiver`, `expired`, `cancelled` |
| `SupportTopic` | `shipment`, `payments`, `account`, `carrier`, `security` |
| `SupportStatus` | `open`, `awaiting_user`, `resolved` |
| `SupportPriority` | `urgent`, `high`, `normal`, `low` |
| `SupportMessageKind` | `user`, `agent`, `note`, `system`, `event` |
| `SupportAttachmentUploader` | `user`, `staff` |
| `DisputeReason` | `damaged`, `not_delivered`, `wrong_delivery`, `other`, `transit_anomaly`, `pickup_no_show` |
| `DisputeStatus` | `open`, `resolving`, `resolved` |
| `DisputeOutcome` | `sender`, `carrier`, `partial` |
| `DisputePartyRole` | `sender`, `receiver`, `carrier` |
| `DisputeStatementKind` | `statement`, `amendment` |

: Enumerados del esquema `shipments`.

### Diccionario de datos completo

#### `shipments`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `sender_id` | uuid | no nulo | Referencias lógicas a users.users, sin FK real (AC5, ADR-003). |
| `receiver_id` | uuid | no nulo |  |
| `carrier_id` | uuid | nulo |  |
| `package_type` | enum PackageType | no nulo |  |
| `weight_kg` | numeric | no nulo |  |
| `length_cm` | numeric | no nulo |  |
| `width_cm` | numeric | no nulo |  |
| `height_cm` | numeric | no nulo |  |
| `oversized` | bool | no nulo, por defecto false | el emisor eligió "Más de 300 cm" en alguno de los lados. |
| `payment_simulated` | bool | no nulo, por defecto false | DD-055: un admin lo pasó a `assigned` sin hold real; payments no se consulta para este envío (nunca se cobra). |
| `description` | text | nulo |  |
| `urgent` | bool | no nulo, por defecto false |  |
| `pickup_address` | text | no nulo |  |
| `pickup_lat` | numeric(9,6) | no nulo |  |
| `pickup_lng` | numeric(9,6) | no nulo |  |
| `pickup_city` | text | nulo | ciudad del punto, del reverse geocoding de svc-users al crear (best-effort). |
| `delivery_address` | text | no nulo |  |
| `delivery_lat` | numeric(9,6) | no nulo |  |
| `delivery_lng` | numeric(9,6) | no nulo |  |
| `delivery_city` | text | nulo |  |
| `pickup_date` | date | no nulo |  |
| `pickup_time_window_start` | time | no nulo |  |
| `pickup_time_window_end` | time | no nulo |  |
| `original_pickup_date` | date | nulo | ventana que pidió el emisor, guardada por `acceptOffer` antes de pisar `pickupDate`/`pickupTimeWindow*` con la acordada. |
| `original_pickup_time_window_start` | time | nulo |  |
| `original_pickup_time_window_end` | time | nulo |  |
| `suggested_price_ars` | numeric | nulo | nullable = "precio a estimar" (AC6), cuando movo-svc-pricing-logistics no respondió o faltaban datos al crear el envío. |
| `calculation_method` | text | nulo | Versión del algoritmo que produjo suggestedPriceArs (PriceCalculationMethod de @movo/shared, ej. |
| `high_demand` | bool | nulo | true si la cotización llevó recargo por alta demanda. |
| `agreed_price_ars` | numeric | nulo |  |
| `distance_km` | numeric(10,2) | nulo | distancia por calle de la cotización, o la estimación en línea recta con el mismo factor de desvío si pricing no respondió. |
| `quote_breakdown` | jsonb | nulo |  |
| `payment_method` | enum PaymentMethod | no nulo, por defecto card | modalidad de pago elegida al crear el envío (`PaymentMethod` de @movo/shared). |
| `estimated_delivery_date` | date | nulo | entrega estimada (día + franja horaria) de la oferta ganadora, copiada acá al aceptarla (offer-repository.ts#acceptOffer) -- mismo criterio que… |
| `estimated_delivery_time_window_start` | varchar(8) | nulo |  |
| `estimated_delivery_time_window_end` | varchar(8) | nulo |  |
| `status` | enum ShipmentStatus | no nulo, por defecto awaiting_receiver_confirmation |  |
| `carrier_withdrawal_pending` | bool | no nulo, por defecto false | Bloquea las transiciones mientras se libera el hold de la asignación que se retira. |
| `carrier_withdrawal_penalty_ars` | numeric(12,2) | nulo |  |
| `last_status_changed_at` | timestamptz | nulo |  |
| `delivered_at` | timestamptz | nulo |  |
| `receiver_confirmation_deadline` | timestamptz | nulo | deadline de confirmación del receptor (createdAt + RECEIVER_CONFIRMATION_TIMEOUT_HOURS). |
| `receiver_redesignation_deadline` | timestamptz | nulo | plazo del emisor para elegir otro receptor tras un rechazo, seteado al pasar a rejected_by_receiver. |
| `transit_anomaly_flagged_at` | timestamptz | nulo | instante en que el barrido de `in_transit` anómalo marcó el envío para revisión (no lo cancela). |
| `transit_anomaly_warned_at` | timestamptz | nulo | instante en que se le avisó al transportista que el envío marcado pasa a disputa si no confirma la entrega. |
| `chat_started_at` | timestamptz | nulo | cuándo empezó la última asignación (`acceptOffer`). |
| `delivery_handshake_started_at` | timestamptz | nulo | instante en que el transportista generó por primera vez el QR de entrega. |
| `funding_deadline_extended_until` | timestamptz | nulo | plazo de pago de `assignment_pending` extendido porque el proveedor de pagos no respondió al intento del emisor. |
| `funding_deadline_extensions` | int | no nulo, por defecto 0 |  |
| `cancellation_penalty_ars` | numeric(12,2) | nulo | penalidad que el emisor confirmó al cancelar un `assigned` con menos de 12 h, y qué pasó con ella. |
| `cancellation_penalty_status` | enum CancellationPenaltyStatus | nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo | Mantenida por trigger de Postgres (shipments.update_updated_at_column()), mismo patrón que users.users — @updatedAt hace que Prisma también la pise… |

: Columnas de `shipments`.

#### `shipment_events`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `shipment_id` | uuid | FK → `shipments`, no nulo |  |
| `from_status` | enum ShipmentStatus | nulo | NULL solo en el evento de creación (no hay "from" antes del primer estado). |
| `to_status` | enum ShipmentStatus | no nulo |  |
| `actor_id` | uuid | nulo | Referencia lógica (sender/receiver/carrier/admin), sin FK — nullable porque una transición futura disparada por el sistema (ej. |
| `assignment_carrier_id` | uuid | nulo | Transportista cuya asignación terminó al volver a published por falta de pago. |
| `reason` | text | nulo |  |
| `attribution` | enum PickupMissedAttribution | nulo | solo en la cancelación del barrido de retiro no realizado. |
| `kind` | enum ShipmentEventKind | no nulo, por defecto normal | cambio hecho desde el panel. |
| `actor_name` | text | nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `shipment_events`.

#### `shipment_photos`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `shipment_id` | uuid | FK → `shipments`, no nulo |  |
| `stage` | enum PhotoStage | no nulo |  |
| `s3_key` | text | no nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `shipment_photos`.

#### `offers`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `shipment_id` | uuid | FK → `shipments`, no nulo |  |
| `carrier_id` | uuid | no nulo | Referencia lógica a users.users, sin FK real (AC4, ADR-003) — mismo criterio que Shipment.senderId/receiverId/carrierId. |
| `price_offered` | numeric | no nulo | AC3: numeric, nunca float. |
| `offered_date` | date | no nulo |  |
| `offered_pickup_time_window_start` | varchar(8) | nulo | franja horaria alternativa de retiro, solo cuando el transportista propone un día/horario distinto al pedido por el emisor (`offeredDate` distinto… |
| `offered_pickup_time_window_end` | varchar(8) | nulo |  |
| `message` | text | nulo | AC2: mensaje opcional del transportista. |
| `carrier_rating_at_offer` | numeric | nulo | AC2: snapshot del transportista al momento de ofertar, evita el N+1 al listar (MOVO-17) y es el dato correcto para una disputa futura ("qué… |
| `carrier_name_at_offer` | text | nulo |  |
| `sender_name_at_offer` | text | nulo | snapshot simétrico del EMISOR al momento de ofertar -- mismo criterio que el snapshot del transportista de arriba (congelado, no lectura en vivo). |
| `sender_verified_at_offer` | bool | nulo |  |
| `sender_rating_at_offer` | numeric | nulo |  |
| `trip_id` | uuid | FK → `trips`, nulo |  |
| `estimated_delivery_date` | date | nulo | entrega estimada (día + franja horaria) declarada por el transportista al ofertar -- opcional, complementa offeredDate (que es de RETIRO, no de… |
| `estimated_delivery_time_window_start` | varchar(8) | nulo |  |
| `estimated_delivery_time_window_end` | varchar(8) | nulo |  |
| `status` | enum OfferStatus | no nulo, por defecto pending |  |
| `expires_at` | timestamptz | nulo | AC2: sostiene la expiración perezosa (AC11). |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `responded_at` | timestamptz | nulo |  |
| `viewed_at_by_sender` | timestamptz | nulo | instante en que el EMISOR vio esta oferta por primera vez (nunca "última vez", ver deriveEffectiveOfferStatus/AC1) -- se completa con un updateMany… |
| `carrier_withdrawn_at` | timestamptz | nulo | el transportista se bajó del envío ya asignado (`carrier_withdrawn`). |
| `withdrawal_penalty_ars` | numeric(12,2) | nulo |  |
| `withdrawal_penalty_status` | enum CancellationPenaltyStatus | nulo |  |

: Columnas de `offers`.

#### `ratings`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `shipment_id` | uuid | FK → `shipments`, no nulo |  |
| `rater_id` | uuid | no nulo | Referencias lógicas a users.users, sin FK real (mismo criterio que Shipment.senderId/receiverId/carrierId, ADR-003). |
| `ratee_id` | uuid | no nulo |  |
| `role` | enum RatingRole | no nulo | Rol del CALIFICADO dentro de este envío en particular -- no un rol de cuenta. |
| `score` | int | no nulo | AC4: entero 1..5, sin medias estrellas -- validado en el schema de la ruta (@movo/shared no define un enum acá, es un número simple). |
| `comment` | text | nulo |  |
| `punctuality_score` | int | nulo | sub-scores opcionales (1..5, validados en el schema de la ruta). |
| `care_score` | int | nulo |  |
| `communication_score` | int | nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `ratings`.

#### `handshake_events`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `shipment_id` | uuid | FK → `shipments`, no nulo |  |
| `stage` | enum HandshakeStage | no nulo |  |
| `actor_id` | uuid | no nulo | actor_id = quien confirma la custodia (llama a /confirm); counterparty_id = quien generó el QR (el cedente, llamó a /generate). |
| `counterparty_id` | uuid | no nulo |  |
| `nonce_hash` | text | no nulo | SHA-256 hex del nonce -- nunca se persiste el nonce en texto plano, ya cumplió su función de un solo uso en Redis antes de llegar acá. |
| `counterparty_lat` | numeric(9,6) | no nulo |  |
| `counterparty_lng` | numeric(9,6) | no nulo |  |
| `actor_lat` | numeric(9,6) | no nulo |  |
| `actor_lng` | numeric(9,6) | no nulo |  |
| `distance_m` | numeric(8,2) | no nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `handshake_events`.

#### `carrier_positions`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `shipment_id` | uuid | FK → `shipments`, no nulo |  |
| `trip_id` | uuid | FK → `trips`, no nulo | asociar al viaje (Trip) para agrupar y controlar cadencia por viaje (VRPTW). |
| `lat` | numeric(9,6) | no nulo |  |
| `lng` | numeric(9,6) | no nulo |  |
| `accuracy_m` | numeric(8,2) | no nulo | Precisión reportada por el dispositivo (metros) -- mismo formato que `HandshakeEvent.distanceM`. |
| `captured_at` | timestamptz | no nulo | Timestamp del DISPOSITIVO (AC1) -- puede ser anterior a `recordedAt` si el mobile encoló posiciones sin red y las mandó después; ahí es donde la… |
| `recorded_at` | timestamptz | no nulo, por defecto now() | Timestamp del SERVIDOR al persistir -- ancla real de la cadencia de ~45s y de la retención (AC6/AC8), nunca `capturedAt` (no confiable, viene del… |
| `mocked` | bool | nulo | flag `mocked` de expo-location (solo Android; NULL si el dispositivo no lo informa). |

: Columnas de `carrier_positions`.

#### `pickup_evidence`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `shipment_id` | uuid | PK, FK → `shipments`, no nulo |  |
| `carrier_id` | uuid | no nulo | Transportista de la asignación a la que pertenece la evidencia: si el envío se reasigna, la fila de otro transportista no se lee ni se suma (se… |
| `arrived_at` | timestamptz | nulo | Timestamp del DISPOSITIVO de la primera posición dentro del radio de llegada. |
| `arrived_lat` | numeric(9,6) | nulo |  |
| `arrived_lng` | numeric(9,6) | nulo |  |
| `arrived_accuracy_m` | numeric(8,2) | nulo |  |
| `far_positions_in_window` | int | no nulo, por defecto 0 |  |
| `gray_positions_in_window` | int | no nulo, por defecto 0 |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `pickup_evidence`.

#### `trips`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `carrier_id` | uuid | no nulo | Referencia lógica a users.users, sin FK real (ADR-003). |
| `origin_address` | text | no nulo |  |
| `origin_lat` | numeric(9,6) | no nulo |  |
| `origin_lng` | numeric(9,6) | no nulo |  |
| `destination_address` | text | no nulo |  |
| `destination_lat` | numeric(9,6) | no nulo |  |
| `destination_lng` | numeric(9,6) | no nulo |  |
| `departure_at` | timestamptz | no nulo |  |
| `vehicle_type` | text | no nulo |  |
| `status` | enum TripStatus | no nulo, por defecto declared | default pasa de active a declared. |
| `cancelled_at` | timestamptz | nulo |  |
| `started_at` | timestamptz | nulo | cuándo pasó a `active` (lo escribe `start()`). |
| `recurrence_weekdays` | int[] | no nulo, por defecto [] | recurrencia como atributo del trip. |
| `recurrence_until` | date | nulo | Inclusive, calendario argentino. |
| `series_id` | uuid | nulo | El primer trip de la serie usa su propio id; se conserva al apagar la recurrencia. |
| `generated_from_trip_id` | uuid | FK → `trips`, único, nulo | UNIQUE: cada trip tiene a lo sumo un sucesor. |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `trips`.

#### `pricing_game_sessions`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `event_tag` | varchar(64) | no nulo |  |
| `device_id` | varchar(64) | nulo |  |
| `started_at` | timestamptz | no nulo |  |
| `ended_at` | timestamptz | no nulo |  |
| `duration_sec` | int | no nulo |  |
| `completed` | bool | no nulo |  |
| `last_screen` | varchar(32) | no nulo |  |
| `origin_name` | varchar(120) | nulo |  |
| `origin_province` | varchar(120) | nulo |  |
| `origin_lat` | numeric(9,6) | nulo |  |
| `origin_lng` | numeric(9,6) | nulo |  |
| `destination_name` | varchar(120) | nulo |  |
| `destination_province` | varchar(120) | nulo |  |
| `destination_lat` | numeric(9,6) | nulo |  |
| `destination_lng` | numeric(9,6) | nulo |  |
| `package_preset` | varchar(16) | nulo |  |
| `package_type` | enum PackageType | nulo |  |
| `weight_kg` | numeric(6,2) | nulo |  |
| `quote_id` | uuid | nulo | Cotización. |
| `quote_verified` | bool | no nulo, por defecto false |  |
| `calculation_method` | varchar(32) | nulo |  |
| `suggested_price_ars` | numeric(12,2) | nulo |  |
| `high_demand` | bool | nulo |  |
| `distance_km` | numeric(8,2) | nulo |  |
| `distance_source` | varchar(32) | nulo |  |
| `fuel_ars_per_liter` | numeric(10,2) | nulo |  |
| `breakdown` | jsonb | nulo | Desglose completo de pricing (`QuoteBreakdown`), tal cual lo devolvió el servicio. |
| `sender_answer` | varchar(8) | nulo | Emisor: yes \| maybe \| no. |
| `sender_alt_choice` | varchar(8) | nulo |  |
| `sender_wtp_ars` | numeric(12,2) | nulo |  |
| `commission_rate` | numeric(5,4) | nulo | Transportista: misma escala; `courierAltChoice`: +10 \| +20 \| +30 \| custom \| none. |
| `courier_earn_ars` | numeric(12,2) | nulo |  |
| `courier_answer` | varchar(8) | nulo |  |
| `courier_alt_choice` | varchar(8) | nulo |  |
| `courier_wta_ars` | numeric(12,2) | nulo |  |
| `uber_estimate_ars` | numeric(12,2) | nulo |  |
| `email` | varchar(254) | nulo | Solo con consentimiento explícito (sorteo); nunca se expone en `stats`. |
| `user_agent` | varchar(512) | nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `pricing_game_sessions`.

#### `route_game_sessions`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `event_tag` | varchar(64) | no nulo |  |
| `device_id` | varchar(64) | nulo |  |
| `started_at` | timestamptz | no nulo |  |
| `ended_at` | timestamptz | no nulo |  |
| `scenario_id` | varchar(16) | no nulo |  |
| `city` | varchar(64) | no nulo |  |
| `points` | jsonb | no nulo | `{ start, stops[], end }` con nombre, barrio y coordenadas. |
| `stop_count` | int | no nulo |  |
| `user_order` | jsonb | no nulo |  |
| `optimal_order` | jsonb | no nulo |  |
| `user_km` | numeric(8,2) | no nulo |  |
| `optimal_km` | numeric(8,2) | no nulo |  |
| `extra_km` | numeric(8,2) | no nulo |  |
| `user_min` | numeric(8,1) | no nulo |  |
| `optimal_min` | numeric(8,1) | no nulo |  |
| `extra_min` | numeric(8,1) | no nulo |  |
| `efficiency_pct` | numeric(5,1) | no nulo |  |
| `tie` | bool | no nulo |  |
| `time_used_sec` | int | no nulo |  |
| `time_limit_sec` | int | nulo |  |
| `timed_out` | bool | no nulo |  |
| `distance_method` | varchar(32) | nulo |  |
| `computed_by` | varchar(8) | no nulo |  |
| `name` | varchar(18) | nulo | Ranking del día: el nombre se muestra en el stand; `inRanking` lo apaga el reset. |
| `in_ranking` | bool | no nulo, por defecto false |  |
| `ranking_hidden_at` | timestamptz | nulo | Cuándo la sacó el reset: un reenvío posterior no la vuelve a meter al ranking. |
| `email` | varchar(254) | nulo | Solo con consentimiento explícito (sorteo + newsletter). |
| `user_agent` | varchar(512) | nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `route_game_sessions`.

#### `receiver_transfer_requests`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `shipment_id` | uuid | FK → `shipments`, no nulo |  |
| `requested_by` | uuid | no nulo | Referencias lógicas a users.users, sin FK real (ADR-003). |
| `new_receiver_id` | uuid | no nulo |  |
| `requester_name` | text | nulo | Snapshots de nombre al pedirla (mismo criterio que carrierNameAtOffer): la línea de tiempo y el banner del receptor original no dependen de… |
| `new_receiver_name` | text | nulo |  |
| `reason` | text | nulo |  |
| `response_reason` | text | nulo |  |
| `status` | enum ReceiverTransferStatus | no nulo, por defecto pending_new_receiver |  |
| `cancel_reason` | varchar(32) | nulo | `requester` \| `delivery_started`, solo con status `cancelled`. |
| `new_receiver_deadline` | timestamptz | no nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `resolved_at` | timestamptz | nulo |  |
| `resolved_by` | uuid | nulo |  |

: Columnas de `receiver_transfer_requests`.

#### `chat_messages`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `shipment_id` | uuid | FK → `shipments`, no nulo |  |
| `author_id` | uuid | no nulo | Referencia lógica a users.users, sin FK real (ADR-003). |
| `body` | text | no nulo |  |
| `client_message_id` | uuid | no nulo | Lo genera el cliente: reenviar el mismo mensaje (cola offline, reintento) no lo duplica. |
| `moderated` | bool | no nulo, por defecto false | El filtro de lenguaje tapó alguna palabra de `body` (que se guarda ya enmascarado). |
| `author_name` | text | nulo | Primer nombre del autor al escribir: la lista de chats muestra "Diego: ..." sin consultar a svc-users. |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `chat_messages`.

#### `chat_participant_states`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `shipment_id` | uuid | FK → `shipments`, no nulo |  |
| `user_id` | uuid | no nulo | Referencia lógica a users.users, sin FK real (ADR-003). |
| `last_delivered_at` | timestamptz | nulo |  |
| `last_read_at` | timestamptz | nulo |  |

: Columnas de `chat_participant_states`.

#### `chat_reports`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `shipment_id` | uuid | FK → `shipments`, no nulo |  |
| `reporter_id` | uuid | no nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `chat_reports`.

#### `support_conversations`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `code_number` | int | único, no nulo, por defecto autoincrement() | Número del código de display `SOP-NNNN`: la secuencia `support_conversation_code_seq` (arranca en 1001). |
| `user_id` | uuid | no nulo | Referencias lógicas a users.users, sin FK real (ADR-003). |
| `topic` | enum SupportTopic | no nulo |  |
| `status` | enum SupportStatus | no nulo, por defecto open |  |
| `priority` | enum SupportPriority | no nulo, por defecto normal |  |
| `assigned_to` | uuid | nulo |  |
| `shipment_id` | uuid | FK → `shipments`, nulo | Sin onDelete cascade: la conversación es evidencia y sobrevive al envío (retención, DD-051). |
| `tags` | text[] | no nulo, por defecto [] |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `last_message_at` | timestamptz | no nulo, por defecto now() |  |
| `last_user_message_at` | timestamptz | no nulo, por defecto now() | Último mensaje del usuario: base del "esperando hace X min" del panel. |
| `last_agent_read_at` | timestamptz | nulo | Hasta dónde leyó un agente (los tildes "leído" del usuario). |
| `resolved_at` | timestamptz | nulo |  |

: Columnas de `support_conversations`.

#### `support_messages`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `conversation_id` | uuid | FK → `support_conversations`, no nulo |  |
| `kind` | enum SupportMessageKind | no nulo |  |
| `author_id` | uuid | nulo | Referencia lógica a users.users (sin FK real, ADR-003). |
| `author_name` | text | nulo | Nombre de pila del agente al escribir ("Lucía"): el usuario lo ve sin consultar a svc-users. |
| `body` | text | no nulo |  |
| `client_message_id` | uuid | nulo | Lo genera el cliente (usuario o panel): reenviar el mismo mensaje no lo duplica. |
| `moderated` | bool | no nulo, por defecto false | El filtro de lenguaje tapó alguna palabra de `body` (solo mensajes del usuario). |
| `attachment_count` | int | no nulo, por defecto 0 | cuántos adjuntos se asociaron al crearlo (se fija en la misma transacción y no cambia). |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `support_messages`.

#### `support_attachments`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `uploader_id` | uuid | no nulo | Referencia lógica a users.users (sin FK real, ADR-003). |
| `uploader_kind` | enum SupportAttachmentUploader | no nulo |  |
| `conversation_id` | uuid | FK → `support_conversations`, nulo | Nulo solo mientras es de la primera consulta del usuario y todavía no se envió. |
| `message_id` | uuid | FK → `support_messages`, nulo |  |
| `position` | int | nulo | Orden dentro del mensaje (el de `attachmentIds`). |
| `s3_key` | text | único, no nulo |  |
| `content_type` | text | no nulo |  |
| `size_bytes` | int | no nulo |  |
| `width` | int | nulo |  |
| `height` | int | nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `deleting_at` | timestamptz | nulo | El sweep lo marcó para borrar: ya no se puede asociar. |

: Columnas de `support_attachments`.

#### `support_participant_states`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `conversation_id` | uuid | FK → `support_conversations`, no nulo |  |
| `user_id` | uuid | no nulo |  |
| `last_delivered_at` | timestamptz | nulo |  |
| `last_read_at` | timestamptz | nulo |  |

: Columnas de `support_participant_states`.

#### `user_display_names`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `user_id` | uuid | PK, no nulo |  |
| `name` | text | no nulo |  |
| `updated_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `user_display_names`.

#### `disputes`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `shipment_id` | uuid | FK → `shipments`, no nulo |  |
| `opened_by` | uuid | nulo | NULL: la abrió un barrido del sistema (`transit_anomaly`, `pickup_no_show`). |
| `opened_by_role` | enum DisputePartyRole | nulo |  |
| `reason` | enum DisputeReason | no nulo |  |
| `description` | text | no nulo |  |
| `status` | enum DisputeStatus | no nulo, por defecto open |  |
| `opened_at` | timestamptz | no nulo, por defecto now() |  |
| `outcome` | enum DisputeOutcome | nulo | resolución. |
| `resolution_percentage` | int | nulo |  |
| `carrier_amount_ars` | numeric(12,2) | nulo |  |
| `sender_amount_ars` | numeric(12,2) | nulo |  |
| `payment_action` | text | nulo |  |
| `reasoning` | text | nulo |  |
| `resolved_by` | uuid | nulo |  |
| `decided_at` | timestamptz | nulo |  |
| `resolved_at` | timestamptz | nulo |  |

: Columnas de `disputes`.

#### `dispute_statements`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `dispute_id` | uuid | FK → `disputes`, no nulo |  |
| `author_id` | uuid | no nulo |  |
| `author_role` | enum DisputePartyRole | no nulo |  |
| `kind` | enum DisputeStatementKind | no nulo |  |
| `text` | text | no nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `dispute_statements`.

#### `dispute_photos`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `dispute_id` | uuid | FK → `disputes`, no nulo |  |
| `statement_id` | uuid | FK → `dispute_statements`, nulo |  |
| `s3_key` | text | único, no nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `dispute_photos`.

## Pagos (esquema `payments`)

El esquema contiene 11 tablas y 12 tipos enumerados.

![DER: Cuentas de cobro, tarjetas y pago de saldo.](diagrama:der-payments-cuentas){.borde .sin-corte}

![DER: Reservas, liquidaciones, eventos y cuenta corriente.](diagrama:der-payments-holds){.borde .sin-corte}

### Tablas

::: {.tabla-der-inventario}

| Tabla | Propósito | Campos clave |
|----------------|----------------------------------------|----------------------------------------|
| `carrier_mp_accounts` | cuenta de Mercado Pago vinculada por OAuth de cada transportista. | `id`, `user_id`, `token_expires_at` |
| `holds` | reserva de fondos (Auth & Capture, `capture: false`) de un envío. | `id`, `amount_ars`, `base_amount_ars`, `status`, `failure_reason`, `expires_at` |
| `payer_customers` | customer de la cuenta de Movo S.A. en Mercado Pago, uno por emisor. | `id`, `user_id`, `mp_customer_id` |
| `saved_cards` | tarjeta guardada del emisor en su customer de Movo. | `id`, `payment_type` |
| `settlements` | liquidación de un envío (captura del hold + split). | `id`, `shipment_id`, `hold_id`, `gross_amount_ars`, `net_amount_ars`, `carrier_gross_amount_ars`, `status`, `failure_reason` |
| `refunds` | reembolso de un pago ya capturado, una fila por INTENTO. Nace en `processing` ANTES de llamar a MP (mismo criterio que `Settlement`): una caída entre el pedido y la respuesta deja rastro y… | `id`, `settlement_id`, `amount_ars`, `reason`, `mp_idempotency_key`, `status`, `failure_reason` |
| `mp_webhook_notifications` | inbox de las notificaciones del webhook de Mercado Pago (tópico `payment`). | `id`, `mp_notification_id`, `status` |
| `payment_provider_events` | lo que MP hizo sobre un pago por fuera de Movo (contracargo, reembolso, mediación abierta por el pagador). | `id`, `amount_ars` |
| `cash_shipment_payments` | cuenta corriente del USUARIO (no de un rol). | `id`, `shipment_id`, `amount_ars`, `ledger_entry_id` |
| `user_ledger_entries` | – | `id`, `role_at_origin`, `type`, `amount_ars`, `status`, `hold_id`, `reason`, `idempotency_key` |
| `balance_payment_attempts` | un intento de "Pagar mi saldo" (Checkout API: tarjeta guardada + CVV, pago directo a la cuenta cobradora de Movo). | `id`, `amount_ars`, `status`, `mp_payment_id`, `failure_reason` |

: Tablas del esquema `payments`.

:::

### Tipos enumerados

| Tipo | Valores |
|------------------------------|----------------------------------------------------|
| `HoldStatus` | `creating`, `in_process`, `authorized`, `captured`, `cancelled`, `rejected` |
| `HoldFailureReason` | `insufficient_funds`, `card_rejected`, `invalid_data`, `platform_error` |
| `SettlementStatus` | `processing`, `credited`, `failed`, `escalated` |
| `SettlementKind` | `delivery`, `cancellation_penalty`, `dispute_partial` |
| `RefundStatus` | `processing`, `succeeded`, `failed`, `fallback_to_ledger` |
| `MpWebhookNotificationStatus` | `pending`, `processed`, `ignored`, `unverifiable`, `failed` |
| `HoldProviderEventKind` | `cancelled`, `expired`, `rejected` |
| `PaymentProviderEventKind` | `chargeback`, `refund`, `mediation` |
| `LedgerEntryType` | `cancellation_penalty`, `penalty_capture`, `cash_commission`, `fee_offset`, `payment_surcharge`, `voluntary_payment`, `manual_adjustment`, `cancellation_compensation` |
| `LedgerEntryStatus` | `pending`, `reserved`, `settled`, `voided` |
| `LedgerRole` | `sender`, `carrier` |
| `BalanceAttemptStatus` | `creating`, `pending`, `approved`, `rejected`, `failed` |

: Enumerados del esquema `payments`.

### Diccionario de datos completo

#### `carrier_mp_accounts`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `user_id` | uuid | único, no nulo | Referencia lógica a users.users, sin FK real (ADR-003). |
| `mp_user_id` | text | no nulo |  |
| `email` | text | nulo |  |
| `nickname` | text | nulo |  |
| `access_token` | text | nulo |  |
| `refresh_token` | text | nulo |  |
| `public_key` | text | nulo | Del vendedor: la usa el mobile para tokenizar la tarjeta del emisor (MOVO-209). |
| `scope` | text | nulo |  |
| `token_expires_at` | timestamptz | nulo |  |
| `connected_at` | timestamptz | no nulo |  |
| `revoked_at` | timestamptz | nulo |  |
| `unlinked_at` | timestamptz | nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `carrier_mp_accounts`.

#### `holds`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `shipment_id` | uuid | no nulo |  |
| `attempt` | int | no nulo |  |
| `carrier_id` | uuid | no nulo |  |
| `collector_id` | text | no nulo |  |
| `mp_payment_id` | text | nulo |  |
| `amount_ars` | numeric(12,2) | no nulo |  |
| `application_fee_ars` | numeric(12,2) | no nulo |  |
| `base_amount_ars` | numeric(12,2) | no nulo | `amountArs` es lo que se le cobra al emisor (precio + recargo por su deuda) y `applicationFeeArs` la comisión + la deuda que se cobra. |
| `commission_ars` | numeric(12,2) | no nulo |  |
| `debt_offset_ars` | numeric(12,2) | no nulo, por defecto 0 |  |
| `debt_surcharge_ars` | numeric(12,2) | no nulo, por defecto 0 |  |
| `status` | enum HoldStatus | no nulo |  |
| `was_authorized` | bool | no nulo, por defecto false | Persiste si MP autorizó alguna vez el intento; `cancelled` también puede venir de `in_process`. |
| `status_detail` | text | nulo | `status_detail` crudo de MP (`pending_capture`, `cc_rejected_*`, ...). |
| `failure_reason` | enum HoldFailureReason | nulo |  |
| `request_fingerprint` | text | nulo | sha256 de (card_token, email del pagador, medio de pago) del intento. |
| `saved_card_id` | uuid | nulo | tarjeta guardada (`saved_cards.id`) con la que se creó el hold, sin FK (la fila local se borra soft). |
| `payer_id` | uuid | nulo | quién pagó y con qué tarjeta, para listar "lo que pagó cada emisor". `payerId` es el emisor (`payerUserId` de MOVO-282), referencia lógica a… |
| `card_last4` | varchar(4) | nulo |  |
| `card_brand` | varchar(32) | nulo |  |
| `mp_fee_ars` | numeric(12,2) | nulo | comisión de MP de este pago (`mercadopago_fee` de `charges_details`, o de `fee_details` si el pago ya se capturó) sobre el total que paga el emisor. |
| `expires_at` | timestamptz | nulo |  |
| `released_at` | timestamptz | nulo | la fija un trigger la primera vez que el hold pasa a `cancelled` (ver la migración `hold_released_at`). |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `holds`.

#### `payer_customers`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `user_id` | uuid | único, no nulo |  |
| `mp_customer_id` | text | único, no nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `payer_customers`.

#### `saved_cards`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `user_id` | uuid | no nulo |  |
| `mp_card_id` | text | no nulo |  |
| `brand` | text | no nulo |  |
| `last4` | text | no nulo |  |
| `exp_month` | int | no nulo |  |
| `exp_year` | int | no nulo |  |
| `issuer_name` | text | nulo | banco y tipo que devuelve MP al guardar, solo para mostrar. |
| `payment_type` | text | nulo |  |
| `is_default` | bool | no nulo, por defecto false |  |
| `alias` | text | nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `deleted_at` | timestamptz | nulo |  |

: Columnas de `saved_cards`.

#### `settlements`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `shipment_id` | uuid | único, no nulo |  |
| `hold_id` | uuid | FK → `holds`, único, no nulo |  |
| `carrier_id` | uuid | no nulo |  |
| `mp_payment_id` | text | no nulo |  |
| `gross_amount_ars` | numeric(12,2) | no nulo |  |
| `mp_fee_ars` | numeric(12,2) | nulo |  |
| `commission_ars` | numeric(12,2) | no nulo |  |
| `net_amount_ars` | numeric(12,2) | nulo |  |
| `debt_offset_ars` | numeric(12,2) | no nulo, por defecto 0 | deuda de la cuenta corriente cobrada en este envío, aparte de `commissionArs` (que queda solo la comisión de Movo): el descuento al transportista y… |
| `debt_surcharge_ars` | numeric(12,2) | no nulo, por defecto 0 |  |
| `debt_surcharge_fee_ars` | numeric(12,2) | no nulo, por defecto 0 | Parte del `application_fee` retenido que corresponde al recargo (recargo menos la comisión de MP que absorbe Movo): para mostrarle al transportista… |
| `carrier_gross_amount_ars` | numeric(12,2) | nulo | Bruto y fee de MP tal como los ve el transportista (sin el recargo del emisor), fijados al acreditar. |
| `carrier_mp_fee_ars` | numeric(12,2) | nulo |  |
| `status` | enum SettlementStatus | no nulo |  |
| `kind` | enum SettlementKind | no nulo, por defecto delivery |  |
| `failure_reason` | text | nulo | Motivo si quedó `failed` (ver `SettlementFailureReason` en @movo/shared). |
| `status_detail` | text | nulo | `status_detail` crudo de MP al capturar (`accredited`, ...). |
| `attempts` | int | no nulo, por defecto 0 | reintentos de la captura. |
| `next_attempt_at` | timestamptz | nulo |  |
| `last_error` | text | nulo |  |
| `escalated_at` | timestamptz | nulo |  |
| `escalation_reason` | text | nulo |  |
| `captured_at` | timestamptz | nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `settlements`.

#### `refunds`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `settlement_id` | uuid | FK → `settlements`, no nulo |  |
| `shipment_id` | uuid | no nulo |  |
| `hold_id` | uuid | no nulo |  |
| `carrier_id` | uuid | no nulo |  |
| `mp_payment_id` | text | no nulo |  |
| `attempt` | int | no nulo |  |
| `amount_ars` | numeric(12,2) | no nulo |  |
| `reason` | text | no nulo |  |
| `request_key` | text | no nulo |  |
| `request_fingerprint` | text | no nulo | Hash de (monto pedido o total, motivo): una key reusada con otro cuerpo es 409. |
| `admin_id` | uuid | no nulo |  |
| `mp_idempotency_key` | text | único, no nulo |  |
| `status` | enum RefundStatus | no nulo, por defecto processing |  |
| `failure_reason` | text | nulo | Ver `RefundFailureReason` en @movo/shared. |
| `mp_refund_id` | text | nulo |  |
| `mp_response` | jsonb | nulo |  |
| `last_error` | text | nulo |  |
| `ledger_entry_id` | uuid | nulo |  |
| `completed_at` | timestamptz | nulo | Cuándo llegó a un estado final (`succeeded`, `failed` o `fallback_to_ledger`): la fecha del movimiento en el historial. |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `refunds`.

#### `mp_webhook_notifications`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `mp_notification_id` | text | único, no nulo |  |
| `topic` | text | no nulo |  |
| `action` | text | nulo |  |
| `mp_payment_id` | text | no nulo |  |
| `mp_user_id` | text | nulo | `user_id` del body: el vendedor (transportista) dueño del pago. |
| `live_mode` | bool | nulo |  |
| `status` | enum MpWebhookNotificationStatus | no nulo, por defecto pending |  |
| `attempts` | int | no nulo, por defecto 0 |  |
| `next_attempt_at` | timestamptz | no nulo, por defecto now() |  |
| `outcome` | text | nulo | Qué hizo el procesamiento (`hold_cancelled`, `chargeback_recorded`, ...), para auditar. |
| `last_error` | text | nulo |  |
| `hold_id` | uuid | nulo |  |
| `pending_hold_event` | enum HoldProviderEventKind | nulo |  |
| `pending_hold_event_detail` | text | nulo |  |
| `processed_at` | timestamptz | nulo |  |
| `received_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo |  |

: Columnas de `mp_webhook_notifications`.

#### `payment_provider_events`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `hold_id` | uuid | no nulo | Referencias lógicas, sin FK (mismo criterio que `MpWebhookNotification.holdId`). |
| `shipment_id` | uuid | no nulo |  |
| `mp_payment_id` | text | no nulo |  |
| `kind` | enum PaymentProviderEventKind | no nulo |  |
| `mp_status` | text | no nulo |  |
| `mp_status_detail` | text | nulo |  |
| `amount_ars` | numeric(12,2) | nulo | Lo que MP informa como devuelto (`transaction_amount_refunded`), si viene. |
| `hold_status` | enum HoldStatus | no nulo |  |
| `alerted_at` | timestamptz | nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `payment_provider_events`.

#### `cash_shipment_payments`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `shipment_id` | uuid | único, no nulo |  |
| `sender_id` | uuid | no nulo |  |
| `carrier_id` | uuid | no nulo |  |
| `amount_ars` | numeric(12,2) | no nulo | Precio acordado, que el emisor le pagó en mano al transportista. |
| `commission_ars` | numeric(12,2) | no nulo |  |
| `ledger_entry_id` | uuid | FK → `user_ledger_entries`, nulo | `null` solo si la comisión dio cero (el ledger no admite movimientos en cero). |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `cash_shipment_payments`.

#### `user_ledger_entries`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `user_id` | uuid | no nulo |  |
| `role_at_origin` | enum LedgerRole | nulo |  |
| `type` | enum LedgerEntryType | no nulo |  |
| `amount_ars` | numeric(12,2) | no nulo | Con signo, nunca float. |
| `status` | enum LedgerEntryStatus | no nulo, por defecto pending |  |
| `shipment_id` | uuid | nulo |  |
| `hold_id` | uuid | FK → `holds`, nulo |  |
| `payment_id` | text | nulo |  |
| `reason` | text | nulo |  |
| `admin_id` | uuid | nulo |  |
| `idempotency_key` | text | único, no nulo |  |
| `request_fingerprint` | text | no nulo | Hash del cuerpo, para distinguir un reintento legítimo de una key reusada con otros datos. |
| `created_at` | timestamptz | no nulo, por defecto now() | Milisegundos: es la precisión del cursor de paginación (la app la fija al insertar). |

: Columnas de `user_ledger_entries`.

#### `balance_payment_attempts`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `user_id` | uuid | no nulo |  |
| `amount_ars` | numeric(12,2) | no nulo | Lo que el usuario quiso pagar en este intento: siempre positivo (el ledger lo asienta negativo). |
| `status` | enum BalanceAttemptStatus | no nulo, por defecto creating |  |
| `saved_card_id` | uuid | nulo | Tarjeta guardada (`saved_cards.id`) con la que se pagó; sin FK, solo para el historial. |
| `request_fingerprint` | text | no nulo | Hash del cuerpo del pedido (token, tarjeta, medio de pago): un reintento con la misma key solo es seguro si coincide. |
| `mp_payment_id` | text | único, nulo | Pago de MP: único, así un mismo pago no puede asentar dos intentos. |
| `status_detail` | text | nulo |  |
| `failure_reason` | enum HoldFailureReason | nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |
| `updated_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `balance_payment_attempts`.

## Administración (esquema `admin`)

El esquema contiene 3 tablas y 2 tipos enumerados.

![DER: Administración.](diagrama:der-admin){.borde .sin-corte}

### Tablas

::: {.tabla-der-inventario}

| Tabla | Propósito | Campos clave |
|----------------|----------------------------------------|----------------------------------------|
| `audit_log` | una fila por acción de escritura del panel (decisión 4 de MOVO-286). | `id`, `target_type`, `reason` |
| `admin_user_notes` | notas internas del panel sobre un usuario (sección "Notas" de la ficha). | `id` |
| `admin_dispute_notes` | notas internas del panel sobre una disputa (sección "Notas" del expediente). | `id` |

: Tablas del esquema `admin`.

:::

### Tipos enumerados

| Tipo | Valores |
|------------------------------|----------------------------------------------------|
| `AuditOutcome` | `succeeded`, `failed`, `unknown` |
| `AdminTargetType` | `user`, `admin_role`, `shipment`, `chat_report`, `user_report`, `dispute`, `support_conversation`, `report` |

: Enumerados del esquema `admin`.

### Diccionario de datos completo

#### `audit_log`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `admin_id` | uuid | no nulo |  |
| `action` | text | no nulo | Libre a propósito: cada US de admin suma las suyas (ej. |
| `target_type` | enum AdminTargetType | no nulo |  |
| `target_id` | text | no nulo |  |
| `reason` | text | nulo |  |
| `context` | jsonb | nulo |  |
| `outcome` | enum AuditOutcome | no nulo |  |
| `error_code` | text | nulo | Código de ApiError con el que falló la acción (o el rechazo por conflicto). |
| `request_id` | text | nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `audit_log`.

#### `admin_user_notes`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `user_id` | uuid | no nulo |  |
| `admin_id` | uuid | no nulo |  |
| `body` | text | no nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `admin_user_notes`.

#### `admin_dispute_notes`

| Columna | Tipo | Restricciones | Descripción |
|----------------------------------|--------------|-----------------|-------------------------------------|
| `id` | uuid | PK, no nulo |  |
| `dispute_id` | uuid | no nulo |  |
| `admin_id` | uuid | no nulo |  |
| `body` | text | no nulo |  |
| `created_at` | timestamptz | no nulo, por defecto now() |  |

: Columnas de `admin_dispute_notes`.

