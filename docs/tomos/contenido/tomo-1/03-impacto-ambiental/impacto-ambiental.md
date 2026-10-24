::: pendiente
**Documento en elaboración.** El Informe de Impacto Ambiental lo está redactando Juan Cruz Bordino Blanche por separado y se incorporará a este tomo cuando esté listo. Esta página reserva su lugar y recuerda el contenido mínimo que exige la guía de la cátedra.
:::

# Contenido Mínimo Requerido

La *Guía de Documentación a Presentar* establece que este informe evalúa cómo afecta la implementación de la solución al medio ambiente y que debe incluir:

1. **Estimación del consumo energético y de la huella de carbono aproximada** del sistema.
2. **Alternativas de diseño evaluadas por su impacto ambiental** y prácticas adoptadas para reducirlo.
3. **Beneficios obtenidos** a partir de la implementación de la solución.

# Datos del Sistema que Sirven de Insumo

Para facilitar la estimación, el sistema tiene las siguientes características relevantes, documentadas en este mismo tomo y en el Tomo II:

- **Infraestructura:** un único host EC2 por ambiente (desarrollo y producción) con todos los servicios en contenedores Docker (ADR-006), frontends en Vercel y almacenamiento de imágenes en AWS S3. Plan de Proyecto, sección de costo operativo.
- **Capacidad ociosa aprovechada:** el producto traslada paquetes en viajes que las personas ya realizan, lo que reduce los viajes exclusivos de logística (Estudio Inicial, sección de valor para la sociedad).
- **Optimización de rutas:** el motor VRPTW minimiza el desvío del transportista respecto de su ruta declarada.
