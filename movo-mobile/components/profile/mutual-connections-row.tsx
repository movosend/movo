import { Text, View } from "react-native";
import { useMutualConnections } from "../../src/hooks/use-profile";

export interface MutualConnectionsRowProps {
  userId: string;
  testID?: string;
}

/**
 * "Ya envió con N personas con las que vos también enviaste" (MOVO-174, todavía
 * sin backend) — se resuelve solo (fetch propio), oculta si el conteo es 0 o el
 * hook todavía no tiene datos reales. El contrato deja `sampleFirstNames` como
 * decisión de privacidad pendiente (ver esa issue): si viene vacío, el copy cae
 * solo al conteo, sin nombrar a nadie.
 */
export function MutualConnectionsRow({ userId, testID }: MutualConnectionsRowProps) {
  const { data } = useMutualConnections(userId);

  if (!data || data.totalCount === 0) return null;

  const [firstSample] = data.sampleFirstNames;
  const copy =
    firstSample && data.totalCount > 1
      ? `Ya envió con ${firstSample} y ${data.totalCount - 1} persona${data.totalCount - 1 === 1 ? "" : "s"} más con las que vos también enviaste.`
      : firstSample
        ? `Ya envió con ${firstSample}, con quien vos también enviaste.`
        : `Ya envió con ${data.totalCount} persona${data.totalCount === 1 ? "" : "s"} con las que vos también enviaste.`;

  return (
    <View testID={testID} className="flex-row items-center gap-2.5 px-0.5">
      <Text className="flex-1 font-sans text-[12.5px] leading-[17px] text-fg-2">{copy}</Text>
    </View>
  );
}
