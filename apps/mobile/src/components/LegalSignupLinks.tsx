import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import {
  getLegalPrivacyUrl,
  getLegalTermsUrl,
  openLegalUrl,
} from "../lib/legalUrls";

type Props = {
  disabled?: boolean;
};

export default function LegalSignupLinks({ disabled = false }: Props) {
  const { t } = useTranslation();

  return (
    <View style={{ marginTop: 12, marginBottom: 4 }}>
      <Text style={{ color: "#94A3B8", fontSize: 12, lineHeight: 18, textAlign: "center" }}>
        {t(
          "legal.signupNotice",
          "By creating an account you agree to our Terms and Privacy Policy."
        )}
      </Text>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "center",
          gap: 16,
          marginTop: 8,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <TouchableOpacity
          disabled={disabled}
          onPress={() => void openLegalUrl(getLegalTermsUrl())}
        >
          <Text style={{ color: "#60A5FA", fontSize: 12, fontWeight: "700" }}>
            {t("legal.terms", "Terms")}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          disabled={disabled}
          onPress={() => void openLegalUrl(getLegalPrivacyUrl())}
        >
          <Text style={{ color: "#60A5FA", fontSize: 12, fontWeight: "700" }}>
            {t("legal.privacy", "Privacy")}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
