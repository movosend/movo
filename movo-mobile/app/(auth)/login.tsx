import { router } from 'expo-router';
import { ChevronLeft, Eye, EyeOff, Lock } from 'lucide-react-native';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '../../components/auth/primary-button';
import { ErrorBanner } from '../../components/ui/error-banner';
import { TextField } from '../../components/ui/text-field';
import { ApiError } from '@movo/shared/dist/errors/api-error';
import { KycStatus } from '@movo/shared/dist/types/user';
import { authClient } from '../../src/api/auth-client';
import {
  formatPhone,
  isPhoneValid,
  toE164Phone,
  useRegistration,
} from '../../src/hooks/use-registration';
import { friendlyErrorMessage } from '../../src/lib/error-messages';
import { useThemeColors } from '../../src/hooks/use-theme-colors';
import { useAuthStore } from '../../src/store/auth-store';

export default function LoginScreen() {
  const colors = useThemeColors();
  const registration = useRegistration();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState<{ phone?: boolean; password?: boolean }>({});
  const [loading, setLoading] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const phoneError = !phone.trim()
    ? 'Ingresá tu teléfono'
    : isPhoneValid(phone)
      ? ''
      : 'Ingresá un teléfono válido';
  const passwordError = password ? '' : 'Ingresá tu contraseña';

  async function handleLogin() {
    setTouched({ phone: true, password: true });
    if (phoneError || passwordError) return;

    setLoading(true);
    setErrorBanner(null);
    try {
      const response = await authClient.login({ phone: toE164Phone(phone), password });
      await useAuthStore.getState().setSession(response);
      // Mismo criterio que el wizard de registro (MOVO-73): solo una cuenta con KYC
      // aprobado entra al área autenticada. Cualquier otro estado (sin empezar, en
      // curso, en revisión, rechazado, vencido) muestra la misma pantalla de resultado
      // de `/kyc` que ve un usuario recién registrado — nunca una pantalla propia del
      // login.
      if (response.kycStatus === KycStatus.APPROVED) {
        router.replace('/home');
      } else {
        await registration.hydrateFromLogin(response);
        router.replace('/kyc');
      }
    } catch (err) {
      // Cuenta suspendida/deshabilitada tiene su propia pantalla explicativa
      // (no un error inline) — ver `account-suspended.tsx`.
      if (err instanceof ApiError && err.code === 'ACCOUNT_SUSPENDED') {
        router.push('/account-suspended');
        return;
      }
      setErrorBanner(friendlyErrorMessage(err, 'No pudimos iniciar sesión. Intentá de nuevo.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-bg" edges={['top', 'bottom']}>
      <View className="flex-row items-center px-5 pb-3.5 pt-1.5">
        <Pressable
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace("/");
            }
          }}
          className="h-8 w-8 items-center justify-center rounded-full bg-bg-mute"
          testID="login-back"
        >
          <ChevronLeft size={18} color={colors.fg1} strokeWidth={2} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 16 : 0}
      >
        <ScrollView className="flex-1 px-6" keyboardShouldPersistTaps="handled">
          <View className="mt-2 mb-4 h-14 w-14 items-center justify-center rounded-[14px] bg-lime-200">
            <Lock size={26} color="#0A0A0B" strokeWidth={1.8} />
          </View>
          <Text className="mb-1.5 font-sans-semibold text-title text-fg">
            Bienvenido de nuevo
          </Text>
          <Text className="mb-5 font-sans text-body text-fg-2">
            Ingresá con tu teléfono y contraseña para seguir enviando y llevando paquetes.
          </Text>

          <ErrorBanner testID="login-error-banner" message={errorBanner} />

          <TextField
            testID="login-phone"
            label="Teléfono"
            placeholder="351 234 5678"
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
            returnKeyType="next"
            value={phone}
            onChangeText={(v) => setPhone(formatPhone(v))}
            onBlur={() => setTouched((t) => ({ ...t, phone: true }))}
            error={touched.phone ? phoneError : ''}
            leftElement={
              <View className="flex-row items-center gap-1.5">
                <Text className="text-[16px]">🇦🇷</Text>
                <Text className="font-sans text-body text-fg">+54</Text>
              </View>
            }
          />

          <TextField
            testID="login-password"
            label="Contraseña"
            placeholder="Tu contraseña"
            secureTextEntry={!showPassword}
            autoComplete="password"
            textContentType="password"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            value={password}
            onChangeText={setPassword}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            onSubmitEditing={handleLogin}
            error={touched.password ? passwordError : ''}
            rightElement={
              <Pressable
                testID="login-password-toggle"
                onPress={() => setShowPassword((s) => !s)}
                hitSlop={8}
                className="h-7 w-7 items-center justify-center"
              >
                {showPassword ? (
                  <EyeOff size={18} color={colors.fg2} strokeWidth={1.8} />
                ) : (
                  <Eye size={18} color={colors.fg2} strokeWidth={1.8} />
                )}
              </Pressable>
            }
          />

          <Text
            testID="login-forgot-password"
            className="mt-2.5 text-right font-sans text-[13px] text-fg-3"
          >
            Recuperar contraseña (próximamente)
          </Text>

          <View className="h-6" />
        </ScrollView>
      </KeyboardAvoidingView>

      <PrimaryButton
        testID="login-primary-action"
        label={loading ? 'Ingresando…' : 'Iniciar sesión'}
        onPress={handleLogin}
        loading={loading}
        disabled={loading}
      />
      <Pressable
        onPress={() => router.replace('/register')}
        testID="login-go-register"
        className="pb-6"
      >
        <Text className="text-center font-sans text-[13px] text-fg-2">
          ¿No tenés cuenta?{' '}
          <Text className="font-sans-semibold text-fg">Creá una</Text>
        </Text>
      </Pressable>
    </SafeAreaView>
  );
}
