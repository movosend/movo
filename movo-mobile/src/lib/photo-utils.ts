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
 * Redimensiona (lado máximo 1024px) y comprime (JPEG calidad 0.8) la imagen
 * en el cliente antes de subir a S3 (MOVO-98 AC5).
 */
export async function prepareProfilePhoto(imageUri: string): Promise<PreparedPhoto> {
  const manipulationResult = await ImageManipulator.manipulateAsync(
    imageUri,
    [{ resize: { width: MAX_DIMENSION } }],
    {
      compress: JPEG_QUALITY,
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
 * Abre la cámara con recorte nativo cuadrado (1:1) tras verificar permisos.
 */
export async function takePhotoWithCamera(): Promise<{ cancelled: boolean; uri?: string; permissionDenied?: boolean }> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    return { cancelled: true, permissionDenied: true };
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return { cancelled: true };
  }

  return { cancelled: false, uri: result.assets[0].uri };
}

/**
 * Abre la galería con recorte nativo cuadrado (1:1) tras verificar permisos.
 */
export async function pickPhotoFromGallery(): Promise<{ cancelled: boolean; uri?: string; permissionDenied?: boolean }> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    return { cancelled: true, permissionDenied: true };
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 1,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return { cancelled: true };
  }

  return { cancelled: false, uri: result.assets[0].uri };
}
