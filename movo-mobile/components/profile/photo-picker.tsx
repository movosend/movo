import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  Pressable,
  Text,
  View,
} from "react-native";
import { Camera, Image as ImageIcon, Trash2, X } from "lucide-react-native";
import { usersClient } from "../../src/api/users-client";
import { friendlyErrorMessage } from "../../src/lib/error-messages";
import {
  pickPhotoFromGallery,
  prepareProfilePhoto,
  takePhotoWithCamera,
} from "../../src/lib/photo-utils";
import { useThemeColors } from "../../src/hooks/use-theme-colors";
import { ProfileAvatar } from "./profile-avatar";
import { ErrorBanner } from "../ui/error-banner";

export interface PhotoPickerProps {
  currentPhotoUrl: string | null;
  fullName: string;
  onPhotoUpdated: (photoUrl: string | null) => void;
  size?: number;
  showDirectButtons?: boolean;
  disabled?: boolean;
  testID?: string;
}

export function PhotoPicker({
  currentPhotoUrl,
  fullName,
  onPhotoUpdated,
  size = 112,
  showDirectButtons = false,
  disabled = false,
  testID = "photo-picker",
}: PhotoPickerProps) {
  const colors = useThemeColors();
  const [modalVisible, setModalVisible] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function showPermissionAlert(mediaType: "cámara" | "fotos") {
    Alert.alert(
      "Permiso necesario",
      `Movo necesita acceso a tu ${mediaType} para cargar tu foto de perfil. Podés habilitarlo desde los ajustes de tu dispositivo.`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Abrir Ajustes",
          onPress: () => {
            void Linking.openSettings();
          },
        },
      ],
    );
  }

  async function handleProcessAndUpload(imageUri: string) {
    setIsUploading(true);
    setErrorMessage(null);
    try {
      // 1. Redimensionar y comprimir en cliente (AC5)
      const prepared = await prepareProfilePhoto(imageUri);

      // 2. Pedir presigned URL a svc-users (AC6)
      const { uploadUrl, objectKey } = await usersClient.getPhotoUploadUrl({
        contentType: prepared.contentType,
        contentLength: prepared.contentLength,
      });

      // 3. PUT directo a S3 con binario sin Authorization header (ADR-007 / AC6)
      await usersClient.uploadPhotoToS3(
        uploadUrl,
        prepared.blob ?? prepared.uri,
        prepared.contentType,
        prepared.contentLength,
      );

      // 4. Confirmar en svc-users (AC6)
      const confirmation = await usersClient.confirmPhoto({ objectKey });

      // 5. Notificar actualización
      onPhotoUpdated(confirmation.photoUrl);
    } catch (err: unknown) {
      console.warn("[PhotoPicker] Error uploading photo:", err);
      setErrorMessage(
        friendlyErrorMessage(
          err,
          "No pudimos subir tu foto de perfil. Por favor intentá de nuevo.",
        ),
      );
    } finally {
      setIsUploading(false);
    }
  }

  async function handleLaunchCamera() {
    if (disabled || isUploading) return;
    setModalVisible(false);
    setErrorMessage(null);
    try {
      const result = await takePhotoWithCamera();
      if (result.permissionDenied) {
        showPermissionAlert("cámara");
        return;
      }
      if (result.cancelled || !result.uri) return;
      await handleProcessAndUpload(result.uri);
    } catch (err: unknown) {
      setErrorMessage(
        friendlyErrorMessage(err, "Ocurrió un error al abrir la cámara."),
      );
    }
  }

  async function handleLaunchGallery() {
    if (disabled || isUploading) return;
    setModalVisible(false);
    setErrorMessage(null);
    try {
      const result = await pickPhotoFromGallery();
      if (result.permissionDenied) {
        showPermissionAlert("fotos");
        return;
      }
      if (result.cancelled || !result.uri) return;
      await handleProcessAndUpload(result.uri);
    } catch (err: unknown) {
      setErrorMessage(
        friendlyErrorMessage(err, "Ocurrió un error al abrir la galería."),
      );
    }
  }

  async function handleDeletePhoto() {
    if (disabled || isUploading || !currentPhotoUrl) return;
    setModalVisible(false);
    setErrorMessage(null);
    setIsUploading(true);
    try {
      await usersClient.deletePhoto();
      onPhotoUpdated(null);
    } catch (err: unknown) {
      setErrorMessage(
        friendlyErrorMessage(err, "No pudimos eliminar la foto de perfil."),
      );
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <View testID={testID} className="items-center">
      {errorMessage ? (
        <View className="w-full">
          <ErrorBanner
            testID={`${testID}-error`}
            message={errorMessage}
          />
        </View>
      ) : null}

      <View className="relative items-center justify-center">
        <Pressable
          testID={`${testID}-avatar-button`}
          onPress={() => setModalVisible(true)}
          disabled={disabled || isUploading}
          accessibilityRole="button"
          accessibilityLabel="Cambiar foto de perfil"
          className="active:opacity-80"
        >
          <ProfileAvatar
            testID={`${testID}-avatar`}
            fullName={fullName}
            photoUrl={currentPhotoUrl}
            size={size}
          />
          {isUploading && (
            <View
              testID={`${testID}-uploading-overlay`}
              style={{ width: size, height: size, borderRadius: size / 2 }}
              className="absolute inset-0 items-center justify-center bg-black/50"
            >
              <ActivityIndicator size="small" color="#FFFFFF" />
            </View>
          )}
          {!isUploading && (
            <View
              testID={`${testID}-badge-icon`}
              className="absolute bottom-0 right-0 h-9 w-9 items-center justify-center rounded-full border-2 border-bg bg-lime-500 shadow-sm"
            >
              <Camera size={16} color="#0A0A0B" strokeWidth={2.2} />
            </View>
          )}
        </Pressable>
      </View>

      {showDirectButtons && (
        <View className="mt-6 w-full flex-row gap-3">
          <Pressable
            testID={`${testID}-camera-btn`}
            onPress={handleLaunchCamera}
            disabled={disabled || isUploading}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-bg-surface py-3.5 active:opacity-80"
          >
            <Camera size={18} color={colors.fg1} />
            <Text className="font-sans-semibold text-[14px] text-fg">
              Cámara
            </Text>
          </Pressable>

          <Pressable
            testID={`${testID}-gallery-btn`}
            onPress={handleLaunchGallery}
            disabled={disabled || isUploading}
            className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border bg-bg-surface py-3.5 active:opacity-80"
          >
            <ImageIcon size={18} color={colors.fg1} />
            <Text className="font-sans-semibold text-[14px] text-fg">
              Galería
            </Text>
          </Pressable>
        </View>
      )}

      <Modal
        testID={`${testID}-modal`}
        visible={modalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModalVisible(false)}
      >
        <Pressable
          testID={`${testID}-modal-backdrop`}
          className="flex-1 justify-end bg-black/60"
          onPress={() => setModalVisible(false)}
        >
          <Pressable
            className="rounded-t-2xl border-t border-border bg-bg p-6 pb-10"
            onPress={(e) => e.stopPropagation()}
          >
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="font-sans-semibold text-h3 text-fg">
                Foto de perfil
              </Text>
              <Pressable
                testID={`${testID}-modal-close`}
                onPress={() => setModalVisible(false)}
                className="p-1"
              >
                <X size={20} color={colors.fg2} />
              </Pressable>
            </View>

            <View className="gap-2">
              <Pressable
                testID={`${testID}-modal-camera`}
                onPress={handleLaunchCamera}
                className="flex-row items-center gap-3.5 rounded-xl border border-border bg-bg-surface p-4 active:opacity-80"
              >
                <Camera size={20} color={colors.fg1} />
                <Text className="font-sans-medium text-body text-fg">
                  Tomar foto con la cámara
                </Text>
              </Pressable>

              <Pressable
                testID={`${testID}-modal-gallery`}
                onPress={handleLaunchGallery}
                className="flex-row items-center gap-3.5 rounded-xl border border-border bg-bg-surface p-4 active:opacity-80"
              >
                <ImageIcon size={20} color={colors.fg1} />
                <Text className="font-sans-medium text-body text-fg">
                  Elegir de la galería
                </Text>
              </Pressable>

              {currentPhotoUrl ? (
                <Pressable
                  testID={`${testID}-modal-delete`}
                  onPress={handleDeletePhoto}
                  className="flex-row items-center gap-3.5 rounded-xl border border-danger-300 bg-danger-100 p-4 active:opacity-80"
                >
                  <Trash2 size={20} color="#DC2626" />
                  <Text className="font-sans-medium text-body text-danger-700">
                    Eliminar foto actual
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
