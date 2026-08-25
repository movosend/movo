import type { ProfileBadge } from "@movo/shared/dist/types/user-profile";
import { IdCard, ShieldAlert, ShieldCheck, type LucideIcon } from "lucide-react-native";
import { Text, View } from "react-native";

export interface ProfileBadgesProps {
  badges?: ProfileBadge[];
  kycVerified?: boolean;
  licenseVerified?: boolean;
  showLicense?: boolean;
  testID?: string;
}

interface BadgeItem {
  id: string;
  label: string;
  verified: boolean;
  Icon: LucideIcon;
}

/** Insignias de verificación del usuario (DNI, Licencia) integradas debajo del nombre. */
export function ProfileBadges({
  badges,
  kycVerified,
  licenseVerified,
  showLicense = true,
  testID,
}: ProfileBadgesProps) {
  const isKyc = kycVerified ?? (badges?.includes("kyc_verified") ?? false);
  const isLicense = licenseVerified ?? (badges?.includes("license_verified") ?? false);

  const items: BadgeItem[] = [
    {
      id: "kyc_verified",
      label: "DNI",
      verified: isKyc,
      Icon: isKyc ? ShieldCheck : ShieldAlert,
    },
  ];

  if (showLicense) {
    items.push({
      id: "license_verified",
      label: "Licencia",
      verified: isLicense,
      Icon: IdCard,
    });
  }

  return (
    <View testID={testID} className="mt-1 flex-row flex-wrap items-center gap-2.5">
      {items.map(({ id, label, verified, Icon }) => (
        <View
          key={id}
          testID={`profile-badge-${id}`}
          className="flex-row items-center gap-1"
        >
          <Icon
            size={13}
            strokeWidth={2.2}
            color={verified ? "#1F9760" : "#C22F35"}
          />
          <Text
            className={`font-sans-medium text-[12px] ${
              verified ? "text-success-600" : "text-danger-600"
            }`}
          >
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}
