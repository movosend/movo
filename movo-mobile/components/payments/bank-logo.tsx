import { Image, Text, View } from "react-native";
import { bankLogoFor } from "../../src/lib/bank-logos";
import { bankInitials, shortBankName } from "../../src/lib/saved-cards";

export interface BankLogoProps {
  issuerName: string;
  size: number;
  testID?: string;
}

/**
 * Logo del banco emisor (MOVO-101, `assets/bank-logos/`) en un cuadrado redondeado. Sin
 * logo para ese banco, las iniciales del nombre corto, como el bloque "banco detectado"
 * del prototipo.
 */
export function BankLogo({ issuerName, size, testID }: BankLogoProps) {
  const logo = bankLogoFor(issuerName);
  const radius = Math.round(size / 4);
  return (
    <View
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="items-center justify-center overflow-hidden border border-[rgba(10,10,11,0.12)] bg-paper"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {logo ? (
        <Image testID={testID ? `${testID}-image` : undefined} source={logo} style={{ width: size, height: size }} />
      ) : (
        <Text className="font-sans-semibold text-[12px] text-ink-600">{bankInitials(shortBankName(issuerName))}</Text>
      )}
    </View>
  );
}
