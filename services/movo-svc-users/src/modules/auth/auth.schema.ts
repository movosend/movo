export const authSchemas = {
  registerBody: {
    type: "object",
    additionalProperties: false,
    required: ["fullName", "email", "phone", "password", "phoneVerificationToken", "dni", "address"],
    properties: {
      fullName: {
        type: "string",
        // Nombre y apellido (al menos dos palabras): la tabla persiste
        // first_name/last_name por separado (ver migración de MOVO-66).
        // maxLength 160 == el maxLength:80 de cada campo individual en
        // users.schema.ts#patchProfileBody (MOVO-133) x2 -- sin este límite acá, se
        // podía registrar un nombre que el PATCH de edición después rechazaba.
        minLength: 1,
        maxLength: 160,
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
      // MOVO-72: emitido por POST /auth/verify-otp (MOVO-71). Se consume acá (single-use)
      // para setear phoneVerified=true — sin esto, AC2 de MOVO-72 (KYC exige teléfono
      // verificado) es imposible de cumplir de punta a punta.
      phoneVerificationToken: { type: "string" },
      // MOVO-73: DNI argentino, 7 u 8 dígitos. La columna `users.dni` ya existía
      // (nullable, sin unique -- el DER la deja como "candidato natural a unique, no
      // decidido") desde antes de esta US; acá se suma al contrato de registro porque
      // el wizard del mobile ya lo pedía y el schema nunca lo había aceptado.
      dni: { type: "string", pattern: "^\\d{7,8}$" },
      // MOVO-73: tabla `users.address` del DER (docs/movo_der.dbml), implementada
      // recién en esta US -- se crea la primera dirección del usuario (label/is_default/
      // country se hardcodean server-side, no viajan acá) en la misma transacción que
      // el alta de la cuenta. `lat`/`long` vienen del paso de mapa/geocoding del wizard.
      address: {
        type: "object",
        additionalProperties: false,
        required: ["street", "number", "city", "province", "zip", "lat", "long"],
        properties: {
          street: { type: "string" },
          number: { type: "string" },
          floor: { type: "string" },
          city: { type: "string" },
          province: { type: "string" },
          zip: { type: "string" },
          lat: { type: "number" },
          long: { type: "number" },
        },
      },
    },
  },
  // Mismo shape que loginResponse (revisión de PR #51, tmvergara): register() pasa a
  // autenticar igual que login(), el registro deja de ser un paso sin sesión.
  registerResponse: {
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
        enum: ["not_started", "pending", "approved", "rejected", "expired", "manual_review"],
      },
      fullName: { type: "string" },
      roles: {
        type: "array",
        items: { type: "string" },
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
        enum: ["not_started", "pending", "approved", "rejected", "expired", "manual_review"],
      },
      fullName: { type: "string" },
      roles: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
  refreshBody: {
    type: "object",
    additionalProperties: false,
    required: ["refreshToken"],
    properties: {
      refreshToken: { type: "string" },
    },
  },
  // Misma forma que loginResponse: refrescar emite un par de tokens nuevo.
  refreshResponse: {
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
  logoutBody: {
    type: "object",
    additionalProperties: false,
    required: ["refreshToken"],
    properties: {
      refreshToken: { type: "string" },
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
    // MOVO-133 (review de tmvergara sobre PR #91): `sent` distingue "mandé un SMS
    // nuevo" de "reusé el OTP activo, dentro de su cooldown, sin mandar nada" --
    // antes las dos ramas devolvían la misma forma y el cliente no podía saberlo.
    required: ["otpId", "cooldownSeconds", "sent"],
    properties: {
      otpId: { type: "string", format: "uuid" },
      cooldownSeconds: { type: "integer", minimum: 0 },
      sent: { type: "boolean" },
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
