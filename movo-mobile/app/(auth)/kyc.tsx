import { KycStatus } from '@movo/shared/dist/types/user';
import type { VerificationErrorType, VerificationResult } from '@didit-protocol/sdk-react-native';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PrimaryButton } from '../../components/auth/primary-button';
import { useRegistration } from '../../src/hooks/use-registration';

/**
 * Usa el SDK nativo de Didit (`startVerification`) en vez de un WebView: ya
 * está instalado y linkeado en el proyecto (ver package.json/app.json), y
 * cumple mejor el criterio "sin salir de la app" que el WebView que asume el
 * mockup de Claude Design — la UI de captura corre nativa, dentro de la app.
 *
 * El pedido de permiso de cámara lo maneja el SDK internamente: no hay
 * código propio de permisos acá. Si el usuario lo rechaza, `startVerification`
 * resuelve con `type: 'failed'` y `error.type === 'cameraAccessDenied'`, que
 * se mapea a la pantalla de error de más abajo.
 *
 * El paquete se importa con `require()` recién dentro de `beginVerification`,
 * nunca en el top del archivo: `NativeSdkReactNative.ts` (dependencia interna
 * del SDK) llama a `TurboModuleRegistry.getEnforcing(...)` en el scope del
 * módulo, que tira una `Invariant Violation` apenas se evalúa si el módulo
 * nativo no está registrado — como pasa siempre en Expo Go, que no soporta
 * módulos nativos custom. Como expo-router evalúa todas las rutas al
 * arrancar la app, un `import` estático acá tumbaba la app entera (todas
 * las pantallas, no solo esta) en cuanto se abría en Expo Go. Con `require`
 * diferido, el resto de la app funciona en Expo Go; solo este botón
 * requiere un development build (`npx expo prebuild` + build nativo).
 */

type ResultKind =
  | 'approved'
  | 'declined'
  | 'manual_review'
  | VerificationErrorType;

const RESULT_COPY: Record<ResultKind, { title: string; body: string }> = {
  approved: {
    title: '¡Verificación aprobada!',
    body: 'Ya podés enviar y llevar paquetes con total confianza.',
  },
  declined: {
    title: 'No pudimos verificar tu identidad',
    body: 'Los datos no coincidieron con tu documento. Podés intentarlo de nuevo o hablar con soporte.',
  },
  manual_review: {
    title: 'Tu verificación está en revisión',
    body: 'A veces necesitamos un poco más de tiempo para confirmar tu identidad. Te avisamos por notificación en cuanto esté lista.',
  },
  sessionExpired: {
    title: 'La sesión de verificación venció',
    body: 'Pasó demasiado tiempo y Didit cerró la sesión por seguridad. Podés empezar de nuevo cuando quieras.',
  },
  networkError: {
    title: 'Se cortó la conexión',
    body: 'No pudimos completar la verificación por un problema de red. Revisá tu conexión e intentá de nuevo.',
  },
  cameraAccessDenied: {
    title: 'Necesitamos acceso a tu cámara',
    body: 'Didit necesita la cámara para la foto del DNI y la selfie. Activá el permiso en Ajustes y volvé a intentar.',
  },
  notInitialized: {
    title: 'Verificación interrumpida',
    body: 'Hubo un problema iniciando la verificación. Intentá de nuevo.',
  },
  apiError: {
    title: 'Verificación interrumpida',
    body: 'Hubo un problema con el servicio de verificación. Intentá de nuevo en unos minutos.',
  },
  retryBlocked: {
    title: 'Alcanzaste el límite de intentos',
    body: 'Por seguridad, contactá a soporte para continuar con la verificación.',
  },
  unknown: {
    title: 'Verificación interrumpida',
    body: 'Algo salió mal. Podés retomarla cuando quieras.',
  },
};

const RETRYABLE: ResultKind[] = [
  'declined',
  'sessionExpired',
  'networkError',
  'cameraAccessDenied',
  'notInitialized',
  'apiError',
  'unknown',
];

function kycStatusToResultKind(status: KycStatus): ResultKind | null {
  switch (status) {
    case KycStatus.APPROVED:
      return 'approved';
    case KycStatus.REJECTED:
      return 'declined';
    case KycStatus.PENDING:
      return 'manual_review';
    case KycStatus.EXPIRED:
      return 'sessionExpired';
    default:
      return null;
  }
}

export default function KycScreen() {
  const registration = useRegistration();
  const { kycStatus, loading, errorBanner, createKycSession, refreshKycStatus } = registration;
  const [phase, setPhase] = useState<'intro' | 'connecting' | 'result'>('intro');
  const [resultKind, setResultKind] = useState<ResultKind | null>(null);

  // Reanudable (AC7): si venimos de un registro en curso con un kycStatus
  // ya distinto de "not_started", saltamos directo al resultado en vez de
  // mostrar la intro de nuevo.
  useEffect(() => {
    const resumed = kycStatus ? kycStatusToResultKind(kycStatus) : null;
    if (resumed) {
      setResultKind(resumed);
      setPhase('result');
    }
  }, [kycStatus]);

  async function beginVerification() {
    const session = await createKycSession();
    if (!session.ok || !session.sessionToken) return;

    setPhase('connecting');

    let result: VerificationResult;
    try {
      // Ver comentario del módulo: import diferido a propósito.
      const sdk = require('@didit-protocol/sdk-react-native') as typeof import('@didit-protocol/sdk-react-native');
      result = await sdk.startVerification(session.sessionToken, { languageCode: 'es' });
    } catch {
      // No hay development build (ej: corriendo en Expo Go) — el módulo
      // nativo no está registrado. No es un error de Didit en sí.
      setResultKind('notInitialized');
      setPhase('result');
      return;
    }

    if (result.type === 'completed') {
      switch (result.session.status) {
        case 'Approved':
          setResultKind('approved');
          break;
        case 'Declined':
          setResultKind('declined');
          break;
        case 'Pending':
          setResultKind('manual_review');
          break;
      }
      setPhase('result');
      void refreshKycStatus();
    } else if (result.type === 'cancelled') {
      setPhase('intro');
    } else {
      setResultKind(result.error.type);
      setPhase('result');
    }
  }

  function goHome() {
    // No hay área autenticada todavía (post-login es MOVO-76+) — vuelve al
    // inicio de la app.
    router.replace('/');
  }

  if (phase === 'connecting') {
    return (
      <SafeAreaView className="flex-1 items-center justify-center bg-paper px-8">
        <ActivityIndicator size="large" color="#0A0A0B" />
        <Text className="mb-2 mt-6 text-center font-sans-semibold text-h3 text-ink-950">
          Conectando con Didit…
        </Text>
        <Text className="text-center font-sans text-[13px] text-fg-2">
          Te vamos a llevar a la ventana segura de verificación de nuestro socio.
        </Text>
      </SafeAreaView>
    );
  }

  if (phase === 'result' && resultKind) {
    const copy = RESULT_COPY[resultKind];
    const canRetry = RETRYABLE.includes(resultKind);
    return (
      <SafeAreaView className="flex-1 bg-paper px-8 pt-16">
        <View className="flex-1 items-center">
          <View
            className={`mb-5 h-14 w-14 items-center justify-center rounded-[14px] ${
              resultKind === 'approved' ? 'bg-lime-500' : 'bg-ink-100'
            }`}
          >
            <Text className="text-[22px]">{resultKind === 'approved' ? '✓' : resultKind === 'declined' ? '✕' : '…'}</Text>
          </View>
          <Text testID="kyc-result-title" className="mb-2 text-center font-sans-semibold text-h2 text-ink-950">
            {copy.title}
          </Text>
          <Text className="text-center font-sans text-body text-fg-2">{copy.body}</Text>
        </View>
        <PrimaryButton
          testID="kyc-primary-action"
          label={canRetry ? 'Reintentar verificación' : 'Ir al inicio'}
          onPress={canRetry ? beginVerification : goHome}
          loading={loading}
        />
        {canRetry ? (
          <Text onPress={goHome} className="mb-2 text-center font-sans text-[13px] text-fg-3">
            Ir al inicio
          </Text>
        ) : null}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-paper" edges={['top', 'bottom']}>
      <View className="flex-1 px-6 pt-8">
        <Text className="mb-2.5 font-sans-semibold text-[11px] uppercase tracking-[0.6px] text-fg-3">
          Verificación de identidad
        </Text>
        <Image
          source={require('../../assets/movo_logo_full.png')}
          className="mb-4 h-9 w-[100px]"
          resizeMode="contain"
        />
        <Text className="mb-2.5 font-sans-semibold text-title text-ink-950">Confirmemos que sos vos</Text>
        <Text className="mb-4.5 font-sans text-body text-fg-2">
          Para que puedas enviar y llevar paquetes con confianza, necesitamos verificar tu identidad. Lo
          hacemos junto con <Text className="font-sans-semibold text-ink-950">Didit</Text>, nuestro socio de
          verificación. No te va a tomar más de 2 minutos.
        </Text>

        {errorBanner ? (
          <View className="mb-4 rounded-[10px] border border-danger-300 bg-danger-100 px-3.5 py-3">
            <Text className="font-sans text-[13px] text-ink-950">{errorBanner}</Text>
          </View>
        ) : null}

        <View className="gap-3.5">
          <IntroStep number={1} text="Te pedimos unas fotos de tu Documento Nacional de Identidad" />
          <IntroStep number={2} text="Capturamos una selfie de tu rostro para asegurarnos de que efectivamente sos vos" />
          <IntroStep number={3} text="Validamos tu identidad con un sistema seguro y privado" />
        </View>

        <Text className="mt-5 font-sans text-[12px] text-fg-3">
          Tus datos están protegidos y solo se usan para verificar tu identidad. Movo no almacena imágenes de
          tu DNI ni tu rostro.
        </Text>
      </View>

      <PrimaryButton
        testID="kyc-begin-verification"
        label={loading ? 'Iniciando…' : 'Empezar verificación con Didit'}
        onPress={beginVerification}
        loading={loading}
        disabled={loading}
      />
    </SafeAreaView>
  );
}

function IntroStep({ number, text }: { number: number; text: string }) {
  return (
    <View className="flex-row items-start gap-3">
      <View className="h-6.5 w-6.5 items-center justify-center rounded-full bg-ink-100">
        <Text className="font-sans-semibold text-[12px] text-ink-950">{number}</Text>
      </View>
      <Text className="flex-1 pt-0.5 font-sans text-[13px] text-ink-950">{text}</Text>
    </View>
  );
}
