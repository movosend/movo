# Descripción del Tema

**EP-02 · Publicación y Descubrimiento** cubre el lado de la oferta y la demanda antes de que exista un acuerdo: el emisor cotiza y publica un envío, el receptor lo confirma o lo rechaza, el transportista declara sus viajes y descubre los paquetes compatibles con su ruta, y cualquiera de las partes puede consultar sus envíos activos y su historial o cancelar lo que aún no se ejecutó.

El envío nace en `awaiting_receiver_confirmation` y recién pasa a `published`, visible para los transportistas, cuando el receptor lo acepta. El precio sugerido proviene de `movo-svc-pricing-logistics` y se congela por 15 minutos (DD-028) para que el emisor pague lo que vio. La negociación y la asignación siguen en el tema *Asignación y Negociación*.

**Servicios involucrados:** `gateway`, `movo-svc-shipments` (envíos y viajes), `movo-svc-pricing-logistics` (cotización y compatibilidad de rutas), `movo-svc-users` (validación del receptor) y `movo-mobile`; **externos:** Google Routes API (distancias, ADR-015), proveedor de precios de combustible y Amazon S3 (fotos del paquete, ADR-007).
