import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Link } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ErrorBanner } from '../ui/error-banner';
import { getApiOverride, setApiOverride } from '../../src/lib/api-override';
import { getApiBaseUrl } from '../../src/lib/env';
import { useThemeColors } from '../../src/hooks/use-theme-colors';

const EXECUTION_ENVIRONMENT_LABEL: Record<ExecutionEnvironment, string> = {
  [ExecutionEnvironment.Bare]: 'Bare (development build)',
  [ExecutionEnvironment.Standalone]: 'Standalone (build EAS)',
  [ExecutionEnvironment.StoreClient]: 'Expo Go',
};

type ConnectionCheck =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; latencyMs: number }
  | { status: 'error'; message: string };

function InfoRow({ label, value, testID }: { label: string; value: string; testID?: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3 border-b border-border py-3">
      <Text className="shrink-0 font-sans text-small text-fg-2">{label}</Text>
      <Text
        testID={testID}
        className="flex-1 font-sans text-small text-fg text-right"
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {value}
      </Text>
    </View>
  );
}

export default function DevConnectionScreen() {
  const colors = useThemeColors();
  const activeOverride = getApiOverride();
  const [draftUrl, setDraftUrl] = useState(activeOverride ?? '');
  const [savedOverride, setSavedOverride] = useState(activeOverride);
  const [check, setCheck] = useState<ConnectionCheck>({ status: 'idle' });
  const [saveError, setSaveError] = useState<string | null>(null);

  const resolvedUrl = __DEV__ ? getApiOverride() ?? process.env.EXPO_PUBLIC_API_URL ?? '(sin definir)' : getApiBaseUrl();

  async function handleSaveOverride() {
    setSaveError(null);
    const trimmed = draftUrl.trim();
    if (trimmed.length > 0 && !/^https?:\/\//.test(trimmed)) {
      setSaveError('La URL debe empezar con http:// o https://. Ej: http://192.168.1.10:3000');
      return;
    }
    await setApiOverride(trimmed.length > 0 ? trimmed : null);
    setSavedOverride(getApiOverride());
    setCheck({ status: 'idle' });
  }

  async function handleClearOverride() {
    setSaveError(null);
    setDraftUrl('');
    await setApiOverride(null);
    setSavedOverride(null);
    setCheck({ status: 'idle' });
  }

  async function handleTestConnection() {
    setCheck({ status: 'checking' });
    const base = getApiBaseUrl();
    const startedAt = Date.now();
    try {
      const response = await fetch(`${base}/health`);
      const latencyMs = Date.now() - startedAt;
      if (!response.ok) {
        setCheck({ status: 'error', message: `Respondió HTTP ${response.status}` });
        return;
      }
      setCheck({ status: 'ok', latencyMs });
    } catch (error) {
      setCheck({
        status: 'error',
        message: error instanceof Error ? error.message : 'No se pudo conectar',
      });
    }
  }

  return (
    <View className="flex-1 bg-bg">
      <View className="border-b border-border px-6 pb-4 pt-24">
        <Text className="font-sans-medium text-caption uppercase tracking-widest text-fg-3">
          Movo · Dev
        </Text>
        <Text className="font-sans-semibold text-title text-fg">Conexión al backend</Text>
      </View>

      <ScrollView className="flex-1" contentContainerClassName="gap-8 px-6 pb-16 pt-6">
        <View className="gap-1">
          <Text className="font-sans-semibold text-h3 text-fg">Build</Text>
          <View className="rounded-xl border border-border bg-bg-sub px-4">
            <InfoRow label="Versión" value={Constants.expoConfig?.version ?? '?'} testID="dev-connection-app-version" />
            <InfoRow
              label="Tipo de build"
              value={__DEV__ ? 'Development (__DEV__)' : 'Production'}
              testID="dev-connection-build-type"
            />
            <InfoRow
              label="Entorno de ejecución"
              value={
                Constants.executionEnvironment
                  ? EXECUTION_ENVIRONMENT_LABEL[Constants.executionEnvironment]
                  : '?'
              }
            />
          </View>
        </View>

        <View className="gap-1">
          <Text className="font-sans-semibold text-h3 text-fg">API</Text>
          <View className="rounded-xl border border-border bg-bg-sub px-4">
            <InfoRow label="EXPO_PUBLIC_API_URL" value={process.env.EXPO_PUBLIC_API_URL ?? '(sin definir)'} />
            <InfoRow
              label="Override activo"
              value={savedOverride ?? '(ninguno)'}
              testID="dev-connection-active-override"
            />
            <InfoRow label="URL efectiva" value={resolvedUrl} testID="dev-connection-resolved-url" />
          </View>
        </View>

        {!__DEV__ ? (
          <ErrorBanner message="El override de backend solo está disponible en builds de desarrollo — este build lo ignora." />
        ) : (
          <View className="gap-3">
            <Text className="font-sans-semibold text-h3 text-fg">Backend local</Text>
            <Text className="font-sans text-small text-fg-2">
              Apuntá la app a un backend corriendo en tu red local. Usá la IP LAN de tu
              máquina, no `localhost` — un dispositivo físico no la resuelve.
            </Text>
            <ErrorBanner message={saveError} testID="dev-connection-save-error" />
            <TextInput
              testID="dev-connection-url-input"
              value={draftUrl}
              onChangeText={setDraftUrl}
              placeholder="http://192.168.1.10:3000"
              placeholderTextColor={colors.fg3}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              className="w-full rounded-md border border-border-strong px-3.5 py-3 font-sans text-[15px] text-fg"
            />
            <View className="flex-row gap-3">
              <Pressable
                onPress={handleSaveOverride}
                testID="dev-connection-save"
                className="flex-1 items-center justify-center rounded-lg bg-fg py-3"
              >
                <Text className="font-sans-semibold text-body text-bg">Guardar</Text>
              </Pressable>
              <Pressable
                onPress={handleClearOverride}
                testID="dev-connection-clear"
                className="flex-1 items-center justify-center rounded-lg border border-border-strong py-3"
              >
                <Text className="font-sans-semibold text-body text-fg">Quitar override</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View className="gap-3">
          <Text className="font-sans-semibold text-h3 text-fg">Probar conexión</Text>
          <Text className="font-sans text-small text-fg-2">
            Hace un `GET {'{URL efectiva}'}/health` (sin `/api/v1`, igual que el gateway).
          </Text>
          <Pressable
            onPress={handleTestConnection}
            disabled={check.status === 'checking'}
            testID="dev-connection-test"
            className="flex-row items-center justify-center gap-2 rounded-lg bg-fg py-3"
          >
            {check.status === 'checking' ? <ActivityIndicator color={colors.bg} /> : null}
            <Text className="font-sans-semibold text-body text-bg">
              {check.status === 'checking' ? 'Probando…' : 'Probar conexión'}
            </Text>
          </Pressable>
          {check.status === 'ok' ? (
            <Text testID="dev-connection-result-ok" className="font-sans text-small text-success-600">
              ✓ Conectado ({check.latencyMs}ms)
            </Text>
          ) : null}
          {check.status === 'error' ? (
            <Text testID="dev-connection-result-error" className="font-sans text-small text-danger-500">
              ✗ {check.message}
            </Text>
          ) : null}
        </View>

        <Link href="/dev-tokens" className="font-sans text-small text-fg-3 underline" testID="dev-connection-go-tokens">
          Ver tokens de diseño →
        </Link>
      </ScrollView>
    </View>
  );
}
