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
// MOVO-157 AC2: base64 estándar O base64url (con relleno `=` opcional) de una clave
// pública EC -- las libs de WebCrypto/React Native del lado mobile suelen exportar en
// base64url (`-`/`_`, sin padding), así que se acepta el alfabeto de las dos variantes
// en vez de forzar al cliente a reconvertir. Generosa en longitud (2048) para no
// atarse a un tamaño de clave/curva específico, el par se genera client-side y este
// servicio nunca lo interpreta, solo lo persiste.
const DEVICE_PUBLIC_KEY_PATTERN = "^[A-Za-z0-9+/_-]+=*$";
const MAX_DEVICE_PUBLIC_KEY_LENGTH = 2048;
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

// MOVO-152 AC2: mismo shape que `reputationBreakdown` en ratings.schema.ts de
// svc-shipments (el objeto que devuelve `computeReputationScore` para el global y
// para cada desglose por rol) -- duplicado acá por el criterio "autocontenido" de
// arriba, no importado del otro servicio.
// MOVO-170: subconjunto de estadísticas de uso calculable con datos ya persistidos --
// mismo shape que `usageStats` de `reputationBreakdown` en ratings.schema.ts de
// svc-shipments. Opcional (no en `required` de `reputationBreakdown`): `svc-shipments`
// nunca lo omite hoy, pero el fallback `NO_REPUTATION` de `users.service.ts` (cuando
// ese servicio no responde) sí lo hace.
const usageStats = {
  type: "object",
  required: ["delivered", "cancelled", "avgPackageWeightKg"],
  properties: {
    delivered: { type: "integer" },
    cancelled: { type: "integer" },
    avgPackageWeightKg: { type: ["number", "null"] },
  },
};

const reputationBreakdown = {
  type: "object",
  required: ["reputationScore", "ratingCount", "isNewProfile"],
  properties: {
    reputationScore: { type: ["number", "null"] },
    ratingCount: { type: "integer" },
    isNewProfile: { type: "boolean" },
    usageStats,
  },
};

// MOVO-170: `raterName` resuelto local (batch lookup, ver users.service.ts) -- nunca
// crudo desde svc-shipments, que no conoce nombres de usuario.
const recentRatingComment = {
  type: "object",
  required: ["id", "raterId", "raterName", "score", "comment", "createdAt"],
  properties: {
    id: { type: "string" },
    raterId: { type: "string" },
    raterName: { type: "string" },
    score: { type: "integer" },
    comment: { type: ["string", "null"] },
    createdAt: { type: "string", format: "date-time" },
  },
};

// MOVO-152 AC2: campos del desglose por rol + comentarios recientes, agregados al
// contrato del perfil público (`GET /users/:id`, `GET /users/search`) -- nunca a
// `privateProfileResponse` (el AC lo pide solo para el perfil público). MOVO-170 sumó
// memberSince/phoneVerified/emailVerified acá -- a diferencia de recentRatingComments,
// SÍ viajan en `GET /users/search` (no piden I/O extra, ver @movo/shared).
const publicProfileExtras = {
  ratingCount: { type: "integer" },
  isNewProfile: { type: "boolean" },
  asSender: reputationBreakdown,
  asCarrier: reputationBreakdown,
  recentRatingComments: { type: "array", items: recentRatingComment },
  memberSince: { type: "string", format: "date-time" },
  phoneVerified: { type: "boolean" },
  emailVerified: { type: "boolean" },
};
const PUBLIC_PROFILE_EXTRA_REQUIRED = [
  "ratingCount",
  "isNewProfile",
  "asSender",
  "asCarrier",
  "recentRatingComments",
  "memberSince",
  "phoneVerified",
  "emailVerified",
];

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
      "emailVerified",
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
      "bio",
    ],
    properties: {
      id: { type: "string" },
      firstName: { type: "string" },
      lastName: { type: "string" },
      fullName: { type: "string" },
      email: { type: "string" },
      emailVerified: { type: "boolean" },
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
      bio: { type: ["string", "null"] },
    },
  },

  searchQuery: {
    type: "object",
    required: ["q"],
    properties: {
      q: { type: "string", minLength: 2, maxLength: 100 },
    },
  },

  // MOVO-171: `bio` va acá, no en `publicProfileExtras` -- decisión de producto de
  // que bio viaje solo en el perfil individual (`GET /users/:id`), nunca en
  // `GET /users/search`, que reusa ese objeto compartido (ver `searchResponse`).
  publicProfileResponse: {
    type: "object",
    required: [
      "id",
      "fullName",
      "photoUrl",
      "isVerified",
      "badges",
      "transactionCounts",
      "reputationScore",
      "bio",
      ...PUBLIC_PROFILE_EXTRA_REQUIRED,
    ],
    properties: {
      id: { type: "string" },
      fullName: { type: "string" },
      photoUrl: { type: ["string", "null"] },
      isVerified: { type: "boolean" },
      badges: { type: "array", items: { type: "string", enum: PROFILE_BADGE_VALUES } },
      transactionCounts,
      reputationScore: { type: ["number", "null"] },
      bio: { type: ["string", "null"] },
      ...publicProfileExtras,
    },
  },

  // MOVO-152 AC2: mismo shape que `publicProfileResponse`, `recentRatingComments`
  // siempre viaja vacío acá (composición liviana, ver `searchUsers` en users.service.ts).
  searchResponse: {
    type: "array",
    items: {
      type: "object",
      required: [
        "id",
        "fullName",
        "photoUrl",
        "isVerified",
        "badges",
        "transactionCounts",
        "reputationScore",
        ...PUBLIC_PROFILE_EXTRA_REQUIRED,
      ],
      properties: {
        id: { type: "string" },
        fullName: { type: "string" },
        photoUrl: { type: ["string", "null"] },
        isVerified: { type: "boolean" },
        badges: { type: "array", items: { type: "string", enum: PROFILE_BADGE_VALUES } },
        transactionCounts,
        reputationScore: { type: ["number", "null"] },
        ...publicProfileExtras,
      },
    },
  },

  // MOVO-170: "ver todas las calificaciones" (`GET /users/:id/ratings`) -- keyset
  // pagination, sin convención de cursor previa en el repo (ver
  // ratings.schema.ts#recentRatingsQuery de svc-shipments, mismo criterio).
  ratingsQuery: {
    type: "object",
    properties: {
      limit: { type: "integer", minimum: 1, maximum: 50, default: 10 },
      cursor: { type: "string" },
    },
  },

  ratingsListResponse: {
    type: "object",
    required: ["items", "nextCursor"],
    properties: {
      items: { type: "array", items: recentRatingComment },
      nextCursor: { type: ["string", "null"] },
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
      // MOVO-171: sin minLength (para que "" pase validación y el servicio la
      // convierta a null) ni pattern (prosa libre, a diferencia de NAME_FIELD_PATTERN).
      bio: { type: "string", maxLength: 280 },
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

  // MOVO-157 AC2/AC5: registro/rotación de la clave pública del dispositivo del
  // usuario autenticado -- ver DEVICE_PUBLIC_KEY_PATTERN arriba.
  registerDeviceKeyBody: {
    type: "object",
    additionalProperties: false,
    required: ["publicKey"],
    properties: {
      publicKey: {
        type: "string",
        minLength: 1,
        maxLength: MAX_DEVICE_PUBLIC_KEY_LENGTH,
        pattern: DEVICE_PUBLIC_KEY_PATTERN,
      },
    },
  },

  registerDeviceKeyResponse: {
    type: "object",
    required: ["registeredAt"],
    properties: {
      registeredAt: { type: "string", format: "date-time" },
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
