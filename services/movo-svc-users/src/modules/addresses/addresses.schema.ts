// Autocontenido a propósito (no importa de otros *.schema.ts) — mismo criterio que ya
// usa el resto de los módulos: cada schema no comparte definiciones entre sí.

const addressResponse = {
  type: "object",
  required: [
    "id",
    "label",
    "isDefault",
    "street",
    "streetNumber",
    "floorApartment",
    "city",
    "province",
    "postalCode",
    "country",
    "lat",
    "long",
    "createdAt",
    "updatedAt",
  ],
  properties: {
    id: { type: "string", format: "uuid" },
    label: { type: ["string", "null"] },
    isDefault: { type: "boolean" },
    street: { type: "string" },
    streetNumber: { type: "string" },
    floorApartment: { type: ["string", "null"] },
    city: { type: "string" },
    province: { type: "string" },
    postalCode: { type: "string" },
    country: { type: "string" },
    lat: { type: "number" },
    long: { type: "number" },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
  },
};

// Campos compartidos entre create/update -- duplicados acá (no en una variable
// intermedia importada de otro módulo) para no romper el criterio de "autocontenido".
const addressBodyProperties = {
  label: { type: ["string", "null"] },
  isDefault: { type: "boolean" },
  street: { type: "string", minLength: 1 },
  streetNumber: { type: "string", minLength: 1 },
  floorApartment: { type: ["string", "null"] },
  city: { type: "string", minLength: 1 },
  province: { type: "string", minLength: 1 },
  postalCode: { type: "string", minLength: 1 },
  country: { type: "string", minLength: 1 },
  lat: { type: "number" },
  long: { type: "number" },
};

export const addressesSchemas = {
  addressIdParam: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid" },
    },
  },

  listResponse: {
    type: "array",
    items: addressResponse,
  },

  createBody: {
    type: "object",
    required: [
      "street",
      "streetNumber",
      "city",
      "province",
      "postalCode",
      "country",
      "lat",
      "long",
    ],
    properties: addressBodyProperties,
  },

  // Update parcial -- ningún campo requerido, `isDefault` solo acepta `true`
  // explícito (el contrato no define un efecto para `isDefault: false` sobre la fila
  // default, ver models/address.ts).
  updateBody: {
    type: "object",
    properties: {
      ...addressBodyProperties,
      isDefault: { type: "boolean", enum: [true] },
    },
  },

  addressResponse,

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
        },
      },
      requestId: { type: "string" },
    },
  },
};
