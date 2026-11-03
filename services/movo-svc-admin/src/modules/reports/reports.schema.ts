import { AdminReportId, CAPTURE_LEAKAGE_STEPS, DISTANCE_BANDS, PRICE_COMPONENTS, reportAppliesBand, reportExportSections, reportKpis } from "@movo/shared";

// Autocontenido a propósito -- mismo criterio que el resto de los *.schema.ts del repo.
const nullableNumber = { type: ["number", "null"] };
const nullableInteger = { type: ["integer", "null"] };
const day = { type: "string", format: "date" };
const rangeObject = { type: "object", required: ["from", "to"], properties: { from: day, to: day } };

const reportValue = { type: "object", required: ["value", "previous"], properties: { value: nullableNumber, previous: nullableNumber } };
const reportPoint = {
  type: "object",
  required: ["start", "end", "value", "previous"],
  properties: { start: day, end: day, value: nullableNumber, previous: nullableNumber },
};
const perKpi = (id: AdminReportId, schema: object) => ({
  type: "object",
  required: [...reportKpis(id)],
  properties: Object.fromEntries(reportKpis(id).map((kpi) => [kpi, schema])),
});

const rangeProperties = {
  from: { type: "string", description: "Día de Argentina, `YYYY-MM-DD`. Sin él, 366 días hacia atrás desde `to`." },
  to: { type: "string", description: "Día de Argentina, `YYYY-MM-DD`, inclusivo. Sin él, hoy." },
};

const queryProperties = (id: AdminReportId) => ({
  ...rangeProperties,
  band: reportAppliesBand(id)
    ? { type: "string", enum: [...DISTANCE_BANDS], description: "Tramo de distancia del envío." }
    : { type: "string", enum: [...DISTANCE_BANDS], description: "Se ignora en este reporte: `meta.bandApplied` es `false`." },
});

const captureAmounts = {
  shipments: { type: "integer" },
  gmvArs: { type: "number" },
  commissionArs: { type: "number" },
};
const captureAmountsObject = { type: "object", required: Object.keys(captureAmounts), properties: captureAmounts };

const REPORT_EXTRAS: Readonly<Record<AdminReportId, Record<string, object>>> = {
  cashflow: {
    pendingCapture: {
      type: "object",
      required: ["count", "amountArs"],
      properties: { count: { type: "integer" }, amountArs: { type: "number" } },
    },
  },
  pricing: {
    bridge: {
      type: ["object", "null"],
      required: ["previous", "current", "volume", "mix", "price"],
      properties: {
        previous: { type: "number" },
        current: { type: "number" },
        volume: { type: "number" },
        mix: { type: "number" },
        price: {
          type: "array",
          items: {
            type: "object",
            required: ["key", "amount"],
            properties: { key: { type: "string", enum: [...PRICE_COMPONENTS] }, amount: { type: "number" } },
          },
        },
      },
    },
    leakage: {
      type: ["object", "null"],
      required: ["quoted", "steps", "captured"],
      properties: {
        quoted: captureAmountsObject,
        steps: {
          type: "array",
          items: {
            type: "object",
            required: ["key", "timing", ...Object.keys(captureAmounts)],
            properties: { key: { type: "string", enum: [...CAPTURE_LEAKAGE_STEPS] }, timing: { type: "boolean" }, ...captureAmounts },
          },
        },
        captured: captureAmountsObject,
      },
    },
  },
  deliveries: {},
  carriers: {
    supply: {
      type: "array",
      items: {
        type: "object",
        required: ["start", "end", "published", "assignedWithin24h"],
        properties: { start: day, end: day, published: nullableInteger, assignedWithin24h: nullableInteger },
      },
    },
  },
  distances: {
    corridors: {
      type: "array",
      items: {
        type: "object",
        required: [
          "originCity",
          "destinationCity",
          "originLat",
          "originLng",
          "destinationLat",
          "destinationLng",
          "distanceKm",
          "band",
          "published",
          "publishedPrevious",
          "completionRate",
        ],
        properties: {
          originCity: { type: "string" },
          destinationCity: { type: "string" },
          originLat: { type: "number" },
          originLng: { type: "number" },
          destinationLat: { type: "number" },
          destinationLng: { type: "number" },
          distanceKm: { type: "number" },
          band: { type: "string", enum: [...DISTANCE_BANDS] },
          published: { type: "integer" },
          publishedPrevious: { type: "integer" },
          completionRate: nullableNumber,
        },
      },
    },
    scorecard: {
      type: "array",
      items: {
        type: "object",
        required: ["band", "published", "completionRate", "onTimeRate", "assignedWithin24hRate", "doorToDoorHours", "avgTicket"],
        properties: {
          band: { type: "string", enum: [...DISTANCE_BANDS] },
          published: reportValue,
          completionRate: reportValue,
          onTimeRate: reportValue,
          assignedWithin24hRate: reportValue,
          doorToDoorHours: reportValue,
          avgTicket: reportValue,
        },
      },
    },
  },
  support: {},
  disputes: {
    backlog: {
      type: "array",
      items: {
        type: "object",
        required: ["status", "count", "medianAgeHours", "oldestOpenedAt"],
        properties: {
          status: { type: "string", enum: ["open", "resolving"] },
          count: { type: "integer" },
          medianAgeHours: nullableNumber,
          oldestOpenedAt: { type: ["string", "null"], format: "date-time" },
        },
      },
    },
    funnel: {
      type: ["array", "null"],
      description: "Las disputas abiertas en el período y hasta dónde llegaron. `null` si no se abrió ninguna.",
      items: {
        type: "object",
        required: ["key", "count", "previous", "medianHoursFromPrevious"],
        properties: {
          key: { type: "string", enum: ["opened", "decided", "resolved"] },
          count: { type: "integer" },
          previous: nullableNumber,
          medianHoursFromPrevious: nullableNumber,
        },
      },
    },
  },
};

export const reportsSchemas = {
  reportQuery: (id: AdminReportId) => ({ type: "object", additionalProperties: false, properties: queryProperties(id) }),

  exportQuery: (id: AdminReportId) => ({
    type: "object",
    additionalProperties: false,
    required: ["section"],
    properties: { ...queryProperties(id), section: { type: "string", enum: reportExportSections(id) } },
  }),

  reportResponse: (id: AdminReportId) => ({
    type: "object",
    required: ["meta", "kpis", "series", "breakdowns", ...Object.keys(REPORT_EXTRAS[id])],
    properties: {
      meta: {
        type: "object",
        required: ["range", "previous", "granularity", "band", "bandApplied", "generatedAt"],
        properties: {
          range: rangeObject,
          previous: rangeObject,
          granularity: { type: "string", enum: ["day", "week", "month"] },
          band: { type: ["string", "null"] },
          bandApplied: { type: "boolean" },
          generatedAt: { type: "string", format: "date-time" },
        },
      },
      kpis: perKpi(id, reportValue),
      series: perKpi(id, { type: "array", items: reportPoint }),
      breakdowns: {
        type: "array",
        items: {
          type: "object",
          required: ["dimension", "metric", "total", "rows"],
          properties: {
            dimension: { type: "string" },
            metric: { type: "string" },
            total: reportValue,
            rows: {
              type: "array",
              items: {
                type: "object",
                required: ["key", "value", "previous", "share"],
                properties: {
                  key: { type: "string" },
                  value: nullableNumber,
                  previous: nullableNumber,
                  share: nullableNumber,
                  extra: { type: "object", additionalProperties: nullableNumber },
                },
              },
            },
          },
        },
      },
      ...REPORT_EXTRAS[id],
    },
  }),

  exportResponse: {
    type: "string",
    description: "CSV (UTF-8 con BOM, CRLF). Las secciones `trend.*` y `breakdown.*` terminan con una fila `Total`.",
  },

  errorResponse: {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message", "statusCode"],
        properties: {
          code: { type: "string" },
          message: { type: "string" },
          statusCode: { type: "integer" },
          details: { type: "object", additionalProperties: true },
        },
      },
      requestId: { type: "string" },
    },
  },
};
