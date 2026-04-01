// apps/mobile/src/screens/DriverHelpScreen.tsx
import React from "react";
import { SafeAreaView, View, Text, TouchableOpacity } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";

export function DriverHelpScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation(); // ✅ re-render auto sur changement de langue

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#020617" }}>
      <View style={{ padding: 16 }}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={{ color: "#93C5FD", fontWeight: "700" }}>
            ← {t("driver.help.back", "Retour")}
          </Text>
        </TouchableOpacity>

        <Text style={{ color: "white", fontSize: 22, fontWeight: "900", marginTop: 12 }}>
          {t("driver.help.title", "Aide")}
        </Text>

        <Text style={{ color: "#9CA3AF", marginTop: 8 }}>
          {t(
            "driver.help.subtitle",
            "FAQ, support, chat admin, urgence."
          )}
        </Text>
      </View>
    </SafeAreaView>
  );
}
