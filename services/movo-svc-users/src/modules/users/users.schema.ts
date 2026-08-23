// Autocontenido a propósito (no importa de otros *.schema.ts) — mismo criterio que ya
// usa el resto de los módulos: cada schema no comparte definiciones entre sí.
const KYC_STATUS_VALUES = ["not_started", "pending", "approved", "rejected", "expired", "manual_review"];
const ACCOUNT_STATUS_VALUES = ["active", "banned", "deleted"];
const USER_ROLE_VALUES = ["sender", "carrier", "admin"];
const PROFILE_BADGE_VALUES = ["kyc_verified", "license_verified"];
// MOVO-97 AC2: mismos valores que ALLOWED_PHOTO_CONTENT_TYPES/MAX_PHOTO_CONTENT_LENGTH_BYTES
// de users.service.ts — duplicados acá por el mismo criterio de "autocontenido" de arriba.
const PHOTO_CONTENT_TYPE_VALUES = ["image/jpeg", "image/png", "image/webp"];
const MAX_PHOTO_CONTENT_LENGTH_BYTES = 5 * 1024 * 1024;
// MOVO-106 AC1: mismos valores que PushPlatform en models/push-token.ts — duplicados
// acá por el mismo criterio de "autocontenido" de arriba.
const PUSH_PLATFORM_VALUES = ["ios", "android"];
// MOVO-133: mismo espíritu que registerBody.fullName de auth.schema.ts (no vacío, sin
// ser solo espacios) adaptado a un campo individual -- no se importa el de
// auth.schema.ts a propósito, mismo criterio "autocontenido" de arriba.
const NAME_FIELD_PATTERN = "^\\S+(\\s+\\S+)*$";
// Mismo patrón que registerBody.phone/sendOtpBody.phone en auth.schema.ts: +54
// opcional, 9 opcional (móvil), 10 dígitos.
const PHONE_PATTERN = "^(\\+?54)?9?\\d{10}$";

const transactionCounts = {
  type: "object",
  required: ["asSender", "asCarrier"],
  properties: {
    asSender: { type: "integer" },
    asCarrier: { type: "integer" },
  },
};

export const usersSchemas = {
  usersCountResponse: {
    type: "object",
    properties: {
      count: { type: "integer" },
    },
    required: ["count"],
  },

  userIdParam: {
    type: "object",
    required: ["id"],
    properties: {
      id: { type: "string", format: "uuid" },
    },
  },

  privateProfileResponse: {
    type: "object",
    required: [
      "id",
      "firstName",
      "lastName",
      "fullName",
      "email",
      "phone",
      "dni",
      "phoneVerified",
      "photoUrl",
      "kycStatus",
      "licenseKycStatus",
      "accountStatus",
      "roles",
      "badges",
      "transactionCounts",
      "reputationScore",
    ],
    properties: {
      id: { type: "string" },
      firstName: { type: "string" },
      lastName: { type: "string" },
      fullName: { type: "string" },
      email: { type: "string" },
      phone: { type: "string" },
      dni: { type: ["string", "null"] },
      phoneVerified: { type: "boolean" },
      photoUrl: { type: ["string", "null"] },
      kycStatus: { type: "string", enum: KYC_STATUS_VALUES },
      licenseKycStatus: { type: "string", enum: KYC_STATUS_VALUES },
      accountStatus: { type: "string", enum: ACCOUNT_STATUS_VALUES },
      roles: { type: "array", items: { type: "string", enum: USER_ROLE_VALUES } },
      badges: { type: "array", items: { type: "string", enum: PROFILE_BADGE_VALUES } },
      transactionCounts,
      reputationScore: { type: ["number", "null"] },
    },
  },

  searchQuery: {
    type: "object",
    required: ["q"],
    properties: {
      q: { type: "string", minLength: 2, maxLength: 100 },
    },
  },

  publicProfileResponse: {
    type: "object",
    required: ["id", "fullName", "photoUrl", "isVerified", "badges", "transactionCounts", "reputationScore"],
    properties: {
      id: { type: "string" },
      fullName: { type: "string" },
      photoUrl: { type: ["string", "null"] },
      isVerified: { type: "boolean" },
      badges: { type: "array", items: { type: "string", enum: PROFILE_BADGE_VALUES } },
      transactionCounts,
      reputationScore: { type: ["number", "null"] },
    },
  },

  searchResponse: {
    type: "array",
    items: {
      type: "object",
      required: ["id", "fullName", "photoUrl", "isVerified", "badges", "transactionCounts", "reputationScore"],
      properties: {
        id: { type: "string" },
        fullName: { type: "string" },
        photoUrl: { type: ["string", "null"] },
        isVerified: { type: "boolean" },
        badges: { type: "array", items: { type: "string", enum: PROFILE_BADGE_VALUES } },
        transactionCounts,
        reputationScore: { type: ["number", "null"] },
      },
    },
  },

  photoUploadUrlBody: {
    type: "object",
    required: ["contentType", "contentLength"],
    properties: {
      contentType: { type: "string", enum: PHOTO_CONTENT_TYPE_VALUES },
      contentLength: { type: "integer", minimum: 1, maximum: MAX_PHOTO_CONTENT_LENGTH_BYTES },
    },
  },

  photoUploadUrlResponse: {
    type: "object",
    required: ["uploadUrl", "objectKey", "expiresIn"],
    properties: {
      uploadUrl: { type: "string" },
      objectKey: { type: "string" },
      expiresIn: { type: "integer" },
    },
  },

  confirmPhotoBody: {
    type: "object",
    required: ["objectKey"],
    properties: {
      objectKey: { type: "string" },
    },
  },

  confirmPhotoResponse: {
    type: "object",
    required: ["photoUrl"],
    properties: {
      photoUrl: { type: "string" },
    },
  },

  registerPushTokenBody: {
    type: "object",
    required: ["expoPushToken", "deviceId", "platform"],
    properties: {
      expoPushToken: { type: "string", minLength: 1 },
      deviceId: { type: "string", minLength: 1 },
      platform: { type: "string", enum: PUSH_PLATFORM_VALUES },
    },
  },

  registerPushTokenResponse: {
    type: "object",
    required: ["deviceId", "platform"],
    properties: {
      deviceId: { type: "string" },
      platform: { type: "string", enum: PUSH_PLATFORM_VALUES },
    },
  },

  unregisterPushTokenBody: {
    type: "object",
    required: ["deviceId"],
    properties: {
      deviceId: { type: "string", minLength: 1 },
    },
  },

  // MOVO-134: mismo patrón que registerBody.password de auth.schema.ts (mínimo 8,
  // al menos una letra y un dígito) -- duplicado acá por el criterio "autocontenido".
  changePasswordBody: {
    type: "object",
    additionalProperties: false,
    required: ["currentPassword", "newPassword"],
    properties: {
      currentPassword: { type: "string", minLength: 1 },
      newPassword: {
        type: "string",
        minLength: 8,
        pattern: "^(?=.*[A-Za-z])(?=.*\\d).{8,}$",
      },
    },
  },

  // Mismo shape que loginResponse de auth.schema.ts (MOVO-134: el cambio de
  // contraseña emite un par de tokens nuevo igual que un login) -- duplicado acá por
  // el criterio "autocontenido".
  changePasswordResponse: {
    type: "object",
    required: ["userId", "accessToken", "refreshToken", "expiresIn", "kycStatus", "fullName", "roles"],
    properties: {
      userId: { type: "string", format: "uuid" },
      accessToken: { type: "string" },
      refreshToken: { type: "string" },
      expiresIn: { type: "integer" },
      kycStatus: { type: "string", enum: KYC_STATUS_VALUES },
      fullName: { type: "string" },
      roles: { type: "array", items: { type: "string", enum: USER_ROLE_VALUES } },
    },
  },

  deleteAccountBody: {
    type: "object",
    additionalProperties: false,
    required: ["password"],
    properties: {
      password: { type: "string", minLength: 1 },
    },
  },

  patchProfileBody: {
    type: "object",
    additionalProperties: false,
    // AC de MOVO-133: body vacío `{}` -- "nada que actualizar" -- es 400, no un no-op.
    minProperties: 1,
    properties: {
      firstName: { type: "string", minLength: 1, maxLength: 80, pattern: NAME_FIELD_PATTERN },
      lastName: { type: "string", minLength: 1, maxLength: 80, pattern: NAME_FIELD_PATTERN },
    },
  },

  phoneChangeOtpBody: {
    type: "object",
    additionalProperties: false,
    required: ["phone"],
    properties: {
      phone: { type: "string", pattern: PHONE_PATTERN },
    },
  },

  emailChangeOtpBody: {
    type: "object",
    additionalProperties: false,
    required: ["email"],
    properties: {
      email: { type: "string", pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
    },
  },

  // Compartido entre el paso 1 de cambio de teléfono y de email (MOVO-133) -- misma
  // forma que sendOtpResponse de auth.schema.ts, duplicado acá por el criterio
  // "autocontenido".
  otpRequestResponse: {
    type: "object",
    // MOVO-133 (review de tmvergara sobre PR #91): `sent` distingue "mandé un SMS
    // nuevo" de "reusé el OTP activo, dentro de su cooldown, sin mandar nada".
    required: ["otpId", "cooldownSeconds", "sent"],
    properties: {
      otpId: { type: "string", format: "uuid" },
      cooldownSeconds: { type: "integer", minimum: 0 },
      sent: { type: "boolean" },
    },
  },

  // Compartido entre el paso 2 de cambio de teléfono y de email.
  otpVerifyBody: {
    type: "object",
    additionalProperties: false,
    required: ["otpId", "code"],
    properties: {
      otpId: { type: "string", format: "uuid" },
      code: { type: "string", pattern: "^\\d{6}$" },
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
};
