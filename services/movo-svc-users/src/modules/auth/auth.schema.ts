export const authSchemas = {
  registerBody: {
    type: "object",
    additionalProperties: false,
    required: ["fullName", "email", "phone", "password"],
    properties: {
      fullName: {
        type: "string",
        // Nombre y apellido (al menos dos palabras): la tabla persiste
        // first_name/last_name por separado (ver migración de MOVO-66).
        pattern: "^\\S+(\\s+\\S+)+$",
      },
      email: {
        type: "string",
        pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
      },
      phone: {
        type: "string",
        // Formato argentino: +54 opcional, 9 opcional (móvil), 10 dígitos (AC2).
        pattern: "^(\\+?54)?9?\\d{10}$",
      },
      password: {
        type: "string",
        minLength: 8,
        pattern: "^(?=.*[A-Za-z])(?=.*\\d).{8,}$",
      },
    },
  },
  registerResponse: {
    type: "object",
    required: ["userId", "kycStatus"],
    properties: {
      userId: { type: "string", format: "uuid" },
      kycStatus: {
        type: "string",
        enum: ["not_started", "pending", "approved", "rejected", "expired"],
      },
    },
  },
  loginBody: {
    type: "object",
    additionalProperties: false,
    required: ["phone", "password"],
    properties: {
      phone: {
        type: "string",
        // Formato argentino: +54 opcional, 9 opcional (móvil), 10 dígitos.
        pattern: "^(\\+?54)?9?\\d{10}$",
      },
      password: {
        type: "string",
        minLength: 1,
      },
    },
  },
  loginResponse: {
    type: "object",
    required: [
      "userId",
      "accessToken",
      "refreshToken",
      "expiresIn",
      "kycStatus",
      "fullName",
      "roles",
    ],
    properties: {
      userId: { type: "string", format: "uuid" },
      accessToken: { type: "string" },
      refreshToken: { type: "string" },
      expiresIn: { type: "integer" },
      kycStatus: {
        type: "string",
        enum: ["not_started", "pending", "approved", "rejected", "expired"],
      },
      fullName: { type: "string" },
      roles: {
        type: "array",
        items: { type: "string" },
      },
    },
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
        },
      },
      requestId: { type: "string" },
    },
  },
  sendOtpBody: {
    type: "object",
    additionalProperties: false,
    required: ["phone"],
    properties: {
      // Mismo patrón que registerBody.phone (AC2 de MOVO-70): +54 opcional, 9 opcional, 10 dígitos.
      phone: {
        type: "string",
        pattern: "^(\\+?54)?9?\\d{10}$",
      },
    },
  },
  sendOtpResponse: {
    type: "object",
    required: ["otpId", "cooldownSeconds"],
    properties: {
      otpId: { type: "string", format: "uuid" },
      cooldownSeconds: { type: "integer", minimum: 0 },
    },
  },
  verifyOtpBody: {
    type: "object",
    additionalProperties: false,
    required: ["otpId", "code"],
    properties: {
      otpId: { type: "string", format: "uuid" },
      code: { type: "string", pattern: "^\\d{6}$" },
    },
  },
  verifyOtpResponse: {
    type: "object",
    required: ["phoneVerificationToken"],
    properties: {
      phoneVerificationToken: { type: "string" },
    },
  },
  resendOtpBody: {
    type: "object",
    additionalProperties: false,
    required: ["otpId"],
    properties: {
      otpId: { type: "string", format: "uuid" },
    },
  },
  resendOtpResponse: {
    type: "object",
    required: ["resentAt", "cooldownSeconds"],
    properties: {
      resentAt: { type: "string", format: "date-time" },
      cooldownSeconds: { type: "integer", minimum: 0 },
    },
  },
};
