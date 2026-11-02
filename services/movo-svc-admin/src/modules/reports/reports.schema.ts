import { DISPUTES_REPORT_EXPORT_SECTIONS, DISPUTES_REPORT_KPIS, DISTANCE_BANDS } from "@movo/shared";

// Autocontenido a propósito -- mismo criterio que el resto de los *.schema.ts del repo.
const nullableNumber = { type: ["number", "null"] };
const day = { type: "string", format: "date" };
const rangeObject = { type: "object", required: ["from", "to"], properties: { from: day, to: day } };

const reportValue = { type: "object", required: ["value", "previous"], properties: { value: nullableNumber, previous: nullableNumber } };
const reportPoint = {
  type: "object",
  required: ["start", "end", "value", "previous"],
  properties: { start: day, end: day, value: nullableNumber, previous: nullableNumber },
};
const perKpi = (schema: object) => ({
  type: "object",
  required: [...DISPUTES_REPORT_KPIS],
  properties: Object.fromEntries(DISPUTES_REPORT_KPIS.map((kpi) => [kpi, schema])),
});

const queryProperties = {
  from: { type: "string", description: "Día de Argentina, `YYYY-MM-DD`. Sin él, 366 días hacia atrás desde `to`." },
  to: { type: "string", description: "Día de Argentina, `YYYY-MM-DD`, inclusivo. Sin él, hoy." },
  band: { type: "string", enum: [...DISTANCE_BANDS], description: "Se ignora en este reporte: `meta.bandApplied` es `false`." },
};

export const reportsSchemas = {
  disputesQuery: { type: "object", additionalProperties: false, properties: queryProperties },

  disputesExportQuery: {
    type: "object",
    additionalProperties: false,
    required: ["section"],
    properties: { ...queryProperties, section: { type: "string", enum: [...DISPUTES_REPORT_EXPORT_SECTIONS] } },
  },

  disputesResponse: {
    type: "object",
    required: ["meta", "kpis", "series", "breakdowns", "backlog", "funnel"],
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
      kpis: perKpi(reportValue),
      series: perKpi({ type: "array", items: reportPoint }),
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
                properties: { key: { type: "string" }, value: nullableNumber, previous: nullableNumber, share: nullableNumber },
              },
            },
          },
        },
      },
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
  },

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
