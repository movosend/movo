import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";

export interface PreparedPhoto {
  uri: string;
  contentType: "image/jpeg";
  contentLength: number;
  blob?: Blob;
}

const MAX_DIMENSION = 1024;
const JPEG_QUALITY = 0.8;

export interface PrepareImageOptions {
  maxDimension: number;
  quality: number;
}

/**
 * Lee un archivo local (file://, ph://, etc.) a un Blob binario en React Native
 * usando XMLHttpRequest (el estándar más confiable en iOS/Android) con fallback a fetch.
 */
export async function uriToBlob(uri: string): Promise<Blob> {
  if (typeof XMLHttpRequest !== "undefined") {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => {
        if (xhr.response) {
          resolve(xhr.response as Blob);
        } else {
          reject(new Error("No se pudo obtener el blob de la imagen local."));
        }
      };
      xhr.onerror = () => {
        reject(new Error("Error al leer el archivo de imagen local."));
      };
      xhr.responseType = "blob";
      xhr.open("GET", uri, true);
      xhr.send(null);
    });
  }

  const res = await fetch(uri);
  if (!res.ok) {
    throw new Error("No se pudo procesar la imagen seleccionada.");
  }
  return res.blob();
}

/**
 * Redimensiona (lado máximo `maxDimension`) y comprime (JPEG, `quality`) una imagen
 * en el cliente antes de subir — generalización de la compresión de foto de perfil
 * (MOVO-98 AC5) para reusarla también en las fotos de envío del wizard (MOVO-83 AC6,
 * valores distintos: 1600px/0.7 según la guía del ticket vs. 1024px/0.8 de perfil).
 */
export async function prepareImageForUpload(
  imageUri: string,
  options: PrepareImageOptions,
): Promise<PreparedPhoto> {
  const manipulationResult = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: { width: options.maxDimension } }],
    {
      compress: options.quality,
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );

  const blob = await uriToBlob(manipulationResult.uri);

  return {
    uri: manipulationResult.uri,
    contentType: "image/jpeg",
    contentLength: blob.size,
    blob,
  };
}

/**
 * Redimensiona (lado máximo 1024px) y comprime (JPEG calidad 0.8) la imagen
 * en el cliente antes de subir a S3 (MOVO-98 AC5).
 */
export function prepareProfilePhoto(imageUri: string): Promise<PreparedPhoto> {
  return prepareImageForUpload(imageUri, { maxDimension: MAX_DIMENSION, quality: JPEG_QUALITY });
}

export interface PickImageOptions {
  /** Default `true` — el recorte cuadrado de perfil (MOVO-98) sigue siendo el default
   * para no romper `photo-picker.tsx`. Las fotos del paquete del wizard de envíos
   * (MOVO-83) lo desactivan: no hay ninguna razón de producto para forzar 1:1 sobre
   * evidencia de un paquete, que casi nunca es cuadrado. */
  allowsEditing?: boolean;
}

/**
 * Abre la cámara (recorte cuadrado 1:1 opcional, ver `PickImageOptions`) tras
 * verificar permisos.
 */
export async function takePhotoWithCamera(
  options?: PickImageOptions,
): Promise<{ cancelled: boolean; uri?: string; permissionDenied?: boolean }> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return { cancelled: true, permissionDenied: true };
  }

  const allowsEditing = options?.allowsEditing ?? true;
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    allowsEditing,
    ...(allowsEditing ? { aspect: [1, 1] as [number, number] } : {}),
    quality: 1,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return { cancelled: true };
  }

  return { cancelled: false, uri: result.assets[0].uri };
}

/**
 * Abre la galería (recorte cuadrado 1:1 opcional, ver `PickImageOptions`) tras
 * verificar permisos.
 */
export async function pickPhotoFromGallery(
  options?: PickImageOptions,
): Promise<{ cancelled: boolean; uri?: string; permissionDenied?: boolean }> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return { cancelled: true, permissionDenied: true };
  }

  const allowsEditing = options?.allowsEditing ?? true;
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing,
    ...(allowsEditing ? { aspect: [1, 1] as [number, number] } : {}),
    quality: 1,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return { cancelled: true };
  }

  return { cancelled: false, uri: result.assets[0].uri };
}
