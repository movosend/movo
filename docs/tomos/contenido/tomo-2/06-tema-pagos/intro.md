# Descripción del Tema

**EP-05 · Pagos y Economía** reúne todo el dinero que circula por Movo, resuelto sobre Mercado Pago como procesador y sin que la plataforma custodie fondos propios. El emisor **reserva** el precio acordado en su tarjeta antes del retiro (una autorización, no un cobro); al confirmarse la entrega, el pago se **captura** y se reparte automáticamente entre el transportista y Movo (*split payment*). Si el envío se cancela, la reserva se libera o se captura parcialmente como penalidad.

Es la tercera capa de confianza (los pagos): ninguna de las partes arriesga dinero antes de que la contraparte cumpla. El tema incluye la vinculación de la cuenta de cobro del transportista (OAuth de Mercado Pago), las tarjetas guardadas del emisor (el backend nunca ve número ni CVV), el historial de pagos y cobros, las penalidades de cancelación (DD-047) y la **cuenta corriente** del usuario, donde se acumulan y cobran las deudas.

**Servicios involucrados:** `movo-svc-payments` (holds, capturas, tarjetas, vinculación y cuenta corriente), `movo-svc-shipments` (saga de asignación, liquidación y cancelaciones), `gateway` y `movo-mobile`; **externo:** Mercado Pago (Checkout API, Marketplace OAuth, Split Payments y webhooks).
