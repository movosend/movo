# Niveles de Testing

El plan de testing cubre tres niveles de prueba complementarios, que garantizan la calidad del sistema desde los componentes individuales hasta los flujos de usuario completos.

## Testing unitario

Pruebas sobre los componentes individuales del sistema, principalmente la lógica de negocio, las validaciones y los servicios internos, de forma aislada, para detectar errores de forma temprana.

## Testing de integración

Verifican la comunicación entre módulos y servicios, incluida la interacción con la base de datos, las APIs externas y los microservicios. Se valida especialmente la persistencia y recuperación de datos, el funcionamiento de los endpoints REST y la integración con los servicios de autenticación y seguridad. **Se ejecutan contra dependencias reales (PostgreSQL 16 y Redis 7 en CI), sin mockear la base de datos.**

## Testing end-to-end (E2E)

Simulan el comportamiento real de los usuarios para validar flujos funcionales completos: inicio de sesión, navegación entre funcionalidades, creación, modificación y consulta de información, y validación de permisos y restricciones de acceso. Se ejecutan antes de entregas parciales, antes de presentaciones y ante cambios relevantes en funcionalidades críticas, no en cada *push*.

## Herramientas por nivel

| Paquete | Framework de testing | Notas |
|---|---|---|
| `gateway` | Vitest + `app.inject()` de Fastify | Proxy inverso sin base de datos propia. |
| `movo-svc-users`, `movo-svc-shipments`, `movo-svc-payments`, `movo-svc-admin` | Vitest + `app.inject()` de Fastify | Integración contra PostgreSQL y Redis reales. |
| `movo-svc-pricing-logistics` | Pytest + `TestClient` de FastAPI, `pytest-cov` | Lint con Ruff y tipos con mypy. |
| `shared/movo-shared` | Vitest | Librería de tipos, JWT y contrato de errores. |
| `movo-mobile` | Jest (`jest-expo`) + React Native Testing Library | Pruebas de componentes, pantallas y lógica de cliente. |
| `movo-admin` | Vitest + Testing Library (jsdom) | Pruebas de componentes y de rutas del panel. |

: Herramientas de testing por paquete.

::: nota
**Desvío respecto del plan original.** El plan de Sprint 0 proponía Jest y Supertest para los servicios Node. Por decisión del equipo se mantuvo **Vitest con `app.inject()`** (ya configurado y funcionando; migrar no aportaba valor) y se incorporó testing a `movo-mobile` y `movo-admin`, que el plan original no cubría. El nivel E2E automatizado (Playwright o Detox) quedó como mejora futura: los flujos de extremo a extremo se verificaron de forma manual, en dispositivos físicos y en el ambiente desplegado, y las verificaciones pendientes se registraron en los tickets de cada historia.
:::

# Criterios de Cobertura Mínima

Se estableció una cobertura mínima aceptable del **70% en pruebas unitarias para los componentes críticos** del sistema, priorizando la lógica de negocio, la seguridad y autenticación, las validaciones, la persistencia de datos y la comunicación entre servicios. Las funcionalidades críticas deben contar obligatoriamente con pruebas asociadas antes de integrarse a la rama principal.

En la práctica, el umbral se fue endureciendo a medida que cada paquete adquirió lógica de dominio real, en lugar de exigir un porcentaje alto desde el primer sprint, que habría producido tests escritos solo para satisfacer el número. Los umbrales vigentes al cierre del proyecto, configurados en los pipelines, son:

| Paquete | Umbral configurado | Observación |
|---|---|---|
| `shared/movo-shared` | 95% líneas y funciones, 90% ramas | Librería base de la que dependen todos los servicios Node. |
| `movo-svc-admin` | 70% líneas | El mínimo acordado para componentes críticos. |
| `movo-svc-users` | 55% líneas | Sobre servicios y repositorios; excluye esquemas y rutas. |
| `movo-svc-pricing-logistics` | 55% global; **100%** en el motor de precios | El cálculo de precios (`pricing.py`, `quote.py`, `config.py`) exige cobertura total en cada Pull Request. |
| Resto de paquetes | Se reporta cobertura, sin umbral estricto | Se evalúa su tendencia en cada Informe de Sprint. |

: Umbrales de cobertura vigentes.

# Tipos y Criticidad de Incidencias

Las incidencias detectadas durante el testing se clasifican según su impacto funcional y técnico en cuatro niveles de severidad:

| Severidad | Tipo de error | Ejemplos | Prioridad |
|---|---|---|---|
| Crítica | Impide el funcionamiento del sistema | Fallas de autenticación, caída del servidor, pérdida de datos | Resolución inmediata |
| Alta | Afecta funcionalidades importantes | Problemas en operaciones principales, fallas entre módulos | Alta urgencia |
| Media | Impacto moderado, con alternativas temporales | Validaciones incorrectas, flujos secundarios | Resolución planificada |
| Baja | Problemas visuales o de bajo impacto | Errores de diseño, textos incorrectos, detalles de UI | Baja urgencia |

: Severidad de las incidencias.

Las incidencias se registran como issues con la etiqueta *Bug* en Linear y se contabilizan en la métrica *Defect Rate* de cada Informe de Sprint. Los informes señalan una limitación conocida de esta métrica: los defectos que se corrigen dentro de otro ticket no quedan etiquetados y, por eso, el Defect Rate subestima los defectos reales.

# Ejecución de Tests y Evaluación de Resultados

## Ejecución continua mediante CI

Las pruebas se ejecutan de forma continua durante el desarrollo y automáticamente en los pipelines de Integración Continua ante cada Pull Request hacia `develop` o `main`. El pipeline detecta qué paquetes cambiaron, levanta PostgreSQL y Redis reales como servicios del job, aplica las migraciones de Prisma y ejecuta lint, verificación de tipos y tests. El check `tests-summary` **bloquea el merge** si alguno falla. Cada nueva funcionalidad o modificación debe superar las pruebas automatizadas antes de integrarse.

## Cuándo se ejecutan las pruebas de integración y E2E

Las pruebas de integración corren en cada Pull Request. Las pruebas de extremo a extremo se realizan antes de cada entrega parcial, durante las etapas de validación interna, previo a despliegues o presentaciones importantes y ante cambios relevantes en funcionalidades críticas.

## Revisión de resultados

La revisión de resultados es responsabilidad del equipo de desarrollo. El *reviewer* de cada Pull Request valida que el check `tests-summary` esté en verde y revisa los números de cobertura de los jobs antes de aprobar; la tendencia de cobertura y de defectos se analiza en el Informe de Sprint de cierre. El equipo analiza las fallas detectadas, corrige las incidencias y verifica nuevamente el funcionamiento antes de aprobar los cambios.

# Estado Final de las Pruebas Automatizadas

Al cierre del proyecto, el repositorio contiene del orden de **6.600 casos de prueba automatizados**, distribuidos así (conteo aproximado de casos `it`/`test`/`def test_` por paquete):

| Paquete | Casos de prueba (aprox.) |
|---|--:|
| `movo-mobile` | 2.700 |
| `movo-svc-shipments` | 1.900 |
| `movo-svc-users` | 800 |
| `movo-svc-payments` | 600 |
| `movo-admin` | 350 |
| `movo-svc-admin` | 105 |
| `movo-svc-pricing-logistics` | 95 |
| `gateway` | 93 |
| `shared/movo-shared` | 84 |

: Casos de prueba automatizados por paquete.

La derivación de casos de prueba formales (precondición, pasos y resultado esperado) para cada historia de usuario se presenta en el **Tomo II**, junto con la trazabilidad de cada historia.
