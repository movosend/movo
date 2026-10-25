# Alcance y Metodología

**Criterio de datos.** El análisis usa solo dos tipos de datos: la configuración y el código del repositorio, y valores publicados por terceros. Cuando falta un dato, como la utilización de CPU, el tráfico de red o el uso real de la app, no se estima: se calcula una cota que no depende de ese dato o se declara como no estimado.

La energía de los servidores se calcula con el método de *Cloud Carbon Footprint* (CCF), que usa coeficientes promedio de AWS.

## Qué entra en el análisis

| Fuente de impacto | ¿Cuantificada? | Tratamiento |
|--------------------------|-----------|------------------------------------------------|
| Cómputo, memoria y disco de las dos instancias EC2 (dev y prod) | Sí | Modelo CCF, con cotas inferior y superior |
| Transferencia de red de las instancias | No | No hay datos de tráfico. CCF asigna 0,001 kWh por GB |
| Imágenes almacenadas en S3 | No | No hay datos del volumen almacenado |
| Equipos de desarrollo y CI en GitHub Actions | No | No hay mediciones de horas ni de potencia |
| Dispositivos de usuarios (tracking en segundo plano) | No | No hay mediciones; se describe la configuración (sección 3.2.3) |
| Emisiones evitadas en el transporte de paquetes | Sí, condicional | Fórmula con factor publicado y desvíos medidos en el spike (sección 3.4) |
| Fabricación de hardware, SaaS de terceros (Vercel, Cloudflare, Twilio, Resend, Didit, Google Maps, Mercado Pago, Expo) y herramientas de IA | No | Sin dato confiable de cada proveedor |

: Fuentes de impacto y su tratamiento.

## Cálculo

La energía de un servidor suma cómputo, memoria y almacenamiento, y se multiplica por el PUE del centro de datos. Las emisiones resultan de multiplicar esa energía por el factor de emisión de la red eléctrica de la región.

<div class="formula">
E = PUE × [ v × (W<sub>mín</sub> + u × (W<sub>máx</sub> − W<sub>mín</sub>)) × h / 1000 + G × c<sub>m</sub> × h + T × c<sub>s</sub> × h ]<br>
CO₂e = E × FE
</div>

Donde *v* = vCPU, *u* = utilización media de CPU, *h* = horas, *G* = GB de RAM, *T* = TB de disco, *c*<sub>m</sub> y *c*<sub>s</sub> = coeficientes de memoria y almacenamiento, y *FE* = factor de emisión. Como *u* no está medida, se calcula con *u* = 0 % (cota inferior) y *u* = 100 % (cota superior): cualquier utilización real da un resultado dentro de ese rango. Se toman 730 horas por mes, que equivale a la instancia encendida todo el mes; si estuviera apagada parte del mes, el consumo sería menor.

## Parámetros y Fuentes

| Parámetro | Valor | Fuente |
|----------------------|--------------------|------------------------------------------------|
| vCPU y memoria de una t3.micro | 2 vCPU y 1 GiB | AWS, instancias Amazon EC2 T3 |
| Potencia por vCPU, mínima y máxima | 0,71 W y 3,46 W | CCF, Apéndice I (commit e48c659). El sitio actual de CCF lista 0,74 W y 3,5 W |
| Memoria | 0,000392 kWh por GB·hora | CCF, Apéndice I |
| Almacenamiento SSD | 1,2 Wh por TB·hora | CCF, Apéndice I |
| Transferencia de red | 0,001 kWh por GB | CCF, Apéndice I |
| PUE de AWS | 1,135 | CCF, Apéndice I |
| Factor de emisión de sa-east-1 | 0,074 kgCO₂e/kWh | CCF, Apéndice IV (commit e48c659). El sitio actual de CCF lista 0,064 |
| Factor de emisión de la red eléctrica argentina, 2022 | 0,283 kgCO₂e/kWh | SNIGEI-AR, Factores de Emisión GEI 2025, tabla 5. Se usa solo como referencia de comparación |
| Automóvil de pasajeros típico | 400 gCO₂ por milla (0,2485 kgCO₂/km) | EPA, flota de Estados Unidos |

: Parámetros del cálculo y sus fuentes.

Los coeficientes de CCF se toman de una versión fija (commit e48c659) para que el cálculo sea reproducible, y la sección 3.2.2 muestra también el resultado con los valores que lista hoy el sitio de CCF. Las direcciones de cada fuente están en la última sección de este informe.

# Estimación del Consumo Energético y Huella de Carbono

La infraestructura de Movo consume entre 36,5 y 145,9 kWh por año y emite entre 2,7 y 10,8 kgCO₂e. El desarrollo y el uso en los teléfonos no se cuantifican, porque no hay datos medidos.

## Configuración verificada

| Elemento | Valor | Fuente |
|-------------|-----------------------------|-----------------------------------|
| Instancias | Una EC2 por ambiente (dev y prod), tipo t3.micro en los dos | `terraform.tfvars` de `envs/dev` y `envs/prod` (`movo-infra`) |
| Región | sa-east-1 (São Paulo) en los dos ambientes | `terraform.tfvars`; `AWS_REGION` en `ci-dev.yml` y `ci-prod.yml` |
| Contenedores | Nueve por instancia: PostgreSQL, Redis, Nginx, gateway y cinco microservicios | `infra/docker-compose.yml` |
| Disco | gp3: 30 GB en dev y 12 GB en prod | `modules/compute` y `envs/dev/main.tf` (`movo-infra`) |
| Red | Elastic IP. Sin balanceador de carga, sin NAT Gateway, sin RDS ni ElastiCache | `movo-infra`, módulos `compute` y `networking` |
| Imagen de sistema | Ubuntu 24.04 amd64 | `modules/compute/main.tf` (`movo-infra`) |

: Configuración de la infraestructura relevada.

## Energía y emisiones de la infraestructura

Un mes de 730 horas. El cómputo depende de la utilización de CPU, que no está medida, así que se muestran las dos cotas.

| Ambiente y utilización | Cómputo (kWh) | Memoria (kWh) | Disco (kWh) | Total con PUE 1,135 (kWh/mes) |
|------------------|--------:|--------:|--------:|----------:|
| Dev, CPU al 0 % | 1,04 | 0,29 | 0,026 | 1,53 |
| Dev, CPU al 100 % | 5,05 | 0,29 | 0,026 | 6,09 |
| Prod, CPU al 0 % | 1,04 | 0,29 | 0,011 | 1,51 |
| Prod, CPU al 100 % | 5,05 | 0,29 | 0,011 | 6,07 |

: Energía mensual por ambiente y cota de utilización.

| Dev + prod | Energía por mes | Energía por año | Emisiones por año (FE 0,074) | Emisiones por año (FE 0,064, sitio actual de CCF) |
|--------------------|--------:|--------:|----------:|----------:|
| Cota inferior (CPU al 0 %) | 3,04 kWh | 36,5 kWh | 2,7 kgCO₂e | 2,4 kgCO₂e |
| Cota superior (CPU al 100 %) | 12,16 kWh | 145,9 kWh | 10,8 kgCO₂e | 9,4 kgCO₂e |

: Energía y emisiones anuales de la infraestructura.

Con los coeficientes actuales del sitio de CCF (0,74 y 3,5 W por vCPU), la energía anual pasa a 37,7 kWh y 147,5 kWh, y las emisiones, calculadas con 0,064 kgCO₂e/kWh, son las de la última columna. La diferencia con la versión fijada es menor que el rango por utilización.

No se incluye la red. Cada GB transferido suma 0,001 kWh (0,001135 kWh con PUE), así que para agregar 1 kWh por mes harían falta unos 880 GB transferidos por mes. El tráfico real no está medido.

## Lo que no se cuantifica

- **Fase de desarrollo.** No hay mediciones de horas ni de potencia de los equipos del equipo, ni de los minutos consumidos por la CI. El flujo de CI sí está optimizado, pero no se estima su energía.
- **Dispositivos de usuarios.** El tracking en segundo plano del transportista usa precisión *Balanced*, una posición cada 45 s o cada 30 m, y un servicio en primer plano con indicador visible (`movo-mobile/src/location/tracking-task.ts`). No se midió el consumo en dispositivos reales.
- **Almacenamiento en S3.** Las fotos se comprimen en el teléfono antes de subirse a S3: 1600 px y calidad JPEG 0,7 en fotos de evidencia, reportes y soporte, y 1024 px y calidad 0,8 en el resto (valor por defecto de `photo-utils.ts`). No hay datos del volumen almacenado.

# Alternativas de Diseño Evaluadas y Prácticas Adoptadas

Las decisiones de arquitectura de Movo se tomaron por costo, simplicidad y alcance del proyecto, no por criterios ambientales. Esta sección las relee con esa óptica: la columna de efecto ambiental es una lectura cualitativa del mecanismo, sin cifras, porque ninguna se midió.

## Decisiones de arquitectura releídas desde lo ambiental

| Decisión | Qué dice el registro o el código | Efecto ambiental (cualitativo) |
|-------------------|-----------------------------|---------------------------------|
| EC2 + Docker Compose | No Kubernetes, ECS ni PaaS. Un host por ambiente | Favorable en principio: los nueve contenedores comparten una sola instancia y no hay un plano de control propio |
| Un PostgreSQL con un esquema por servicio, más Redis | Una sola base compartida | Favorable en principio: una base y una caché para todos los servicios |
| Microservicios | No monolito ni serverless | Desfavorable en principio: cada servicio es un proceso con su memoria |
| Imágenes en S3 con URL prefirmada | El cliente pide una URL y sube la foto directo a S3. El teléfono la redimensiona y comprime antes | Favorable en principio: las fotos no pasan por la instancia y se suben más livianas |
| Tracking por HTTP, difusión por WebSocket | Ingesta con POST (también en lotes de hasta 100 posiciones). La traza guarda una posición por tramo de 45 s | Favorable en principio: acota las escrituras y no mantiene un socket de emisión abierto |
| Retención de la traza GPS | Se purga a los 30 días de cerrado el envío | Favorable en principio: acota el almacenamiento sostenido |
| Navegación por deep-link | Se delega en la app de mapas del dispositivo, en vez del Navigation SDK de Google o un re-routing propio | Favorable en principio: Movo no corre navegación propia. A cambio, el transportista sale de la app |
| Precio comprometido | La cotización queda congelada 15 min en Redis y el envío se crea exactamente a ese precio | Favorable en principio: no recalcula el precio al crear el envío |
| Prefiltro de corredor y solución cacheada | Descarta ofertas a más de 15 km del segmento sin llamar a Google ni a OR-Tools. Al aceptar una oferta se reutiliza la solución guardada: 0 llamadas al solver | Favorable en principio: evita cómputo y llamadas externas. Se midió menos de 20 ms por candidato |
| WebSocket nativo y chat propio | Un solo protocolo para tracking, chat y panel. Se descartó un servicio externo de chat | Favorable en principio: sin servicio externo adicional y con cierre de conexiones muertas |

: Decisiones de arquitectura y su efecto ambiental cualitativo.

## Prácticas adoptadas

Estas prácticas surgieron por costo, estabilidad o rendimiento, y se registran acá por su posible efecto ambiental.

| Práctica | Qué hace |
|----------------------------|------------------------------------------------------|
| Región sa-east-1 | El factor de CCF para sa-east-1 (0,074 kgCO₂e/kWh) es 3,8 veces menor que el de la red argentina (0,283). Es una comparación entre factores publicados, no un ahorro medido |
| Proveedores en modo mock o console por defecto (SMS, KYC, geocoding, push, email, storage) | En desarrollo y CI no se llama a servicios externos |
| CI que corre solo lo afectado por la ruta modificada | Filtro por paths, cancelación de corridas obsoletas, caché de npm y pip, y límite de 5 a 15 minutos por job |
| Tracking con precisión *Balanced* y actualizaciones diferidas | Una posición cada 45 s o cada 30 m en segundo plano |
| Rotación de logs y limpieza de imágenes | Logs de 10 MB × 3 archivos por servicio |
| Caché de reputación en Redis | TTL de 60 s por defecto |

: Prácticas adoptadas con posible efecto ambiental.

## Alternativas evaluadas y no adoptadas

No hay registro en el Terraform ni en los workflows de que ninguna de estas alternativas esté implementada.

| Alternativa | Efecto | Riesgo o condición |
|------------------|--------------------------|-----------------------------------|
| Apagar el ambiente dev fuera de horario | Cada hora apagada evita entre 0,0021 y 0,0083 kWh (cómputo y memoria con PUE, según la utilización) | El deploy automático desde `develop` entra por SSH a la instancia (`ci-dev.yml`), que tendría que estar encendida |
| Instancias Graviton (t4g) | No estimado | La imagen de sistema actual es amd64, y las imágenes de los servicios tendrían que construirse para arm64 |
| Dimensionar la instancia con métricas de CloudWatch | No estimado | No hay métricas relevadas |
| Expiración de objetos en S3 | No estimado | En `movo-infra`, `lifecycle_expiration_days` vale 0 por defecto |

: Alternativas no adoptadas.

# Beneficios de la Solución Actual

El beneficio ambiental de Movo es evitar viajes dedicados: cuando un paquete viaja con alguien que ya iba a hacer el camino, lo que se emite es el desvío y no el viaje entero. Con los datos disponibles se puede calcular cuánto evita cada envío que reemplaza un viaje dedicado, pero no cuántos lo hacen, porque el sistema no opera con usuarios reales.

## Cómo el diseño promueve el beneficio

Movo no suma vehículos: usa el espacio libre de viajes que ya existen. El servicio de pricing y logística calcula para cada candidato el desvío marginal respecto del viaje del transportista.

## Desvíos medidos en el spike

El spike usó un viaje Córdoba Capital a Villa María con una distancia directa de 141,63 km, calculada con la fórmula de Haversine (línea recta). Las ofertas son un catálogo sintético, y la matriz de distancias es un mock Haversine a 75 km/h, no rutas reales.

| Oferta | Resultado del prefiltro | Desvío (km) | Desvío (tiempo) | OR-Tools |
|-------------------|------------------------------------|--------:|--------:|--------:|
| OFFER-102: Oliva a Villa María | Pasa (retiro a 1,37 km y entrega a 0,00 km del segmento) | +0,04 km | +20 min | 0,51 ms |
| OFFER-101: Córdoba a Oncativo | Pasa (retiro a 0,85 km y entrega a 2,08 km del segmento) | +0,60 km | +21 min | 13,82 ms |
| OFFER-103: Carlos Paz a Cosquín | Descartada (retiro a 29,73 km y entrega a 32,80 km del segmento) | No se calcula | No se calcula | No se invoca |
| OFFER-104: Río Cuarto a Villa María | Descartada (retiro a 131,21 km y entrega a 0,00 km del segmento) | No se calcula | No se calcula | No se invoca |

: Desvíos medidos en el spike de optimización de rutas.

## Emisiones evitadas por envío

Si un envío reemplaza un viaje dedicado en auto, las emisiones evitadas son el factor del vehículo por la distancia del viaje dedicado, menos el factor por el desvío del transportista. Con el factor de EPA para un automóvil de pasajeros típico, 400 gCO₂ por milla (0,2485 kgCO₂ por km), y el caso del spike:

<div class="formula">evitado = 0,2485 kgCO₂/km × (distancia del viaje dedicado − desvío)</div>

| Oferta del spike | Viaje dedicado de 141,63 km (kgCO₂) | Desvío (kgCO₂) | Evitado (kgCO₂) | Reducción |
|--------------------|--------:|--------:|--------:|--------:|
| OFFER-102 (+0,04 km) | 35,20 | 0,010 | 35,19 | 99,97 % |
| OFFER-101 (+0,60 km) | 35,20 | 0,149 | 35,05 | 99,58 % |

: Emisiones evitadas por envío en los casos del spike.

Un solo envío como estos evita entre 3,2 y 13 veces lo que emite en un año toda la infraestructura (2,7 a 10,8 kgCO₂e). Esas cifras valen solo bajo estas condiciones:

- El envío tiene que haber reemplazado un viaje dedicado. El sistema no registra qué habría hecho el remitente sin Movo, así que no se puede calcular cuántos envíos cumplen esta condición.
- El factor de EPA corresponde a la flota de Estados Unidos y no a los vehículos de Argentina. La distancia de 141,63 km es en línea recta, y por ruta es mayor.
- Los desvíos salen de un catálogo sintético con distancias Haversine, no de envíos reales.
- Frente al transporte consolidado de una empresa de encomiendas, que reparte las emisiones entre muchos paquetes, el beneficio puede ser menor o nulo. No se cuantificó.
- No se midió el efecto rebote, es decir, envíos que no se harían sin Movo y que ahora generan desvíos.

## Otros beneficios

- **Sin infraestructura física nueva.** El modelo usa la capacidad de viajes ya planificados: no hay flota, depósitos ni centros de distribución propios.
- **Desvío visible.** El desvío de cada candidato ya se calcula y se expone en el contrato de la API, y el feed del spike lo ordena de menor a mayor desvío.
- **Medición futura.** Si se persiste el desvío real de cada envío entregado, el ahorro pasa de proyectarse a medirse (ver la sección siguiente).

# Limitaciones y Trabajo Futuro

## Limitaciones de este análisis

- **Sin métricas reales.** No se consultaron CloudWatch, la facturación de AWS ni la API de GitHub Actions. Por eso la utilización de CPU, el tráfico de red y los minutos de CI no están medidos, y el resultado se expresa como cotas.
- **Configuración informada.** El tipo de instancia y la región se tomaron de `terraform.tfvars`, que no está versionado y lo informó el equipo. El `terraform apply` de prod figura como pendiente, y su huella se calcula como si la instancia estuviera encendida todo el mes.
- **Factores de terceros.** Los coeficientes de consumo y el factor de sa-east-1 son promedios de Cloud Carbon Footprint, no mediciones de AWS, y cambian entre versiones del proyecto. El factor de la red argentina corresponde a 2022.
- **Exclusiones.** La fase de desarrollo, los dispositivos de usuarios, la red, S3, la fabricación de hardware, los servicios SaaS y las herramientas de IA no están cuantificados.
- **Beneficios sin volumen.** No hay usuarios reales ni registro de qué reemplaza cada envío, así que las emisiones evitadas se calculan por envío y no en total.

## Trabajo futuro recomendado

1. **Medir la infraestructura.** Activar métricas de CPU y red en CloudWatch y consultar la AWS Customer Carbon Footprint Tool, para reemplazar las cotas por valores medidos.
2. **Persistir el desvío real.** Guardar los kilómetros de desvío de cada envío entregado, para medir el ahorro en lugar de calcularlo sobre un caso de prueba.
3. **Registrar el reemplazo.** Preguntar al remitente qué habría hecho sin Movo (viaje propio, encomienda, no enviar), para conocer la tasa de sustitución y el efecto rebote.
4. **Revisar la configuración de infraestructura.** Evaluar si dev puede apagarse fuera de horario, si conviene pasar a Graviton (t4g) y si hace falta una política de expiración en S3.

# Conclusiones

- **La huella medible es pequeña.** La infraestructura emite entre 2,7 y 10,8 kgCO₂e al año con los coeficientes fijados, sin depender de la utilización de CPU: dos instancias t3.micro en sa-east-1, sin balanceador de carga ni servicios administrados.
- **Las decisiones de diseño se tomaron por otros motivos.** El registro de decisiones releído con criterio ambiental muestra decisiones favorables en principio (un host por ambiente, base compartida, fotos comprimidas, tracking acotado, prefiltro y caché de rutas) y una desfavorable, la separación en microservicios. Ninguna se cuantificó.
- **El beneficio está en evitar viajes.** Cada envío que reemplaza un viaje dedicado evita, en el caso del spike, unos 35 kgCO₂, más de lo que emite la infraestructura en un año. Falta saber cuántos envíos cumplen esa condición.
- **Lo que falta medir es concreto.** Con usuarios reales y métricas de AWS, las cotas se convierten en mediciones.

# Fuentes y Alcance del Relevamiento

## Fuentes consultadas

- Cloud Carbon Footprint, *Methodology*: https://www.cloudcarbonfootprint.org/docs/methodology/ y su versión fijada en el commit e48c659 (https://github.com/cloud-carbon-footprint/cloud-carbon-footprint/blob/e48c659f6dafc8b783e570053024f28b88aafc79/microsite/docs/Methodology.md): fórmula de energía, coeficientes de AWS, PUE y factor de emisión de sa-east-1.
- AWS, instancias Amazon EC2 T3: https://aws.amazon.com/ec2/instance-types/t3/. Datos usados: 2 vCPU y 1 GiB de memoria de una t3.micro.
- SNIGEI-AR, *Factores de Emisión GEI 2025*: https://inventariogei.ambiente.gob.ar/files/Factores_de_Emision_SNIGEIAR_para_HC_2025.pdf. Dato usado: factor de la red eléctrica argentina, 2022.
- EPA, *Greenhouse Gas Emissions from a Typical Passenger Vehicle*: https://www.epa.gov/greenvehicles/greenhouse-gas-emissions-typical-passenger-vehicle. Dato usado: 400 gCO₂ por milla.
- Repositorio `movosend/movo`, rama `develop` (commit 17504e4): `docker-compose.yml`, workflows de CI, `tracking-task.ts`, `photo-utils.ts`, informe del spike VRPTW, `candidate_evaluator.py`, registro de ADR y `CLAUDE.md`.
- Repositorio `movosend/movo-infra` (Terraform): módulos `compute`, `networking`, `storage` y `secrets`. Los `terraform.tfvars` de dev y prod los informó el equipo.
- Documentos del proyecto: Informe de Sprint 7 (riesgo R17 y formato) y la guía de la cátedra.

## No consultado

CloudWatch, facturación de AWS, la API de GitHub Actions, Linear y Miro. No se ejecutó Terraform ni se accedió a la cuenta de AWS.
