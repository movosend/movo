# @movo/shared

Librería compartida del monorepo Movo. Centraliza:

- **Auth** (`src/auth/`): emisión y verificación de JWT de acceso (`signAccessToken`, `verifyAccessToken`) y emisión de refresh tokens opacos (`signRefreshToken`).
- **Errors** (`src/errors/`): contrato único de error de la API (`ApiError`).
- **Types** (`src/types/`): tipos de dominio compartidos (`UserRole`, `KycStatus`, `AccountStatus`, `ShipmentStatus`).

## Alcance

- No contiene lógica de negocio: solo criptografía, tipos y contratos. Cualquier regla de negocio va en el servicio consumidor.
- `signRefreshToken()` genera un token opaco + `tokenId`, pero **no** lo persiste — guardar su hash en Redis es responsabilidad del servicio que lo consume.
- `JWT_SECRET` se lee de forma perezosa: recién se valida (y falla si falta) la primera vez que se llama a `signAccessToken`/`verifyAccessToken`, no al importar el paquete.

## Consumo

Se consume vía workspace de npm, como `"@movo/shared": "*"` en el `package.json` de cada servicio — nunca por copia de archivos ni por path relativo.

## Convención de `src/index.ts`

Es la zona de conflicto crítica de este paquete: agregá tu export como una línea nueva al final del bloque de tu dominio (`// auth`, `// errors`, `// types`), sin reordenar líneas existentes.

## Estado de los tipos de dominio

`KycStatus` está tomado directamente del DER (`User.kyc_status_identity`). `UserRole`, `AccountStatus` y `ShipmentStatus` son provisorios — ver el comentario en MOVO-67 en Linear para el detalle de qué falta confirmar.
