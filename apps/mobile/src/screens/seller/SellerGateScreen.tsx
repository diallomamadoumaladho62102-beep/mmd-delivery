import React, { useEffect, useState } from "react";
import { View, ActivityIndicator, Text } from "react-native";
import { supabase } from "../../lib/supabase";
import { loadOwnSeller, requireSellerPlatformEnabled } from "../../lib/sellerApi";
import { useTranslation } from "react-i18next";

type Props = { navigation: any };

export default function SellerGateScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const routeSeller = async () => {
      try {
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (!mounted) return;

        if (userError || !user) {
          navigation.replace("ClientAuth");
          return;
        }

        const gate = await requireSellerPlatformEnabled();
        if (!gate.enabled) {
          setMessage(
            gate.message ??
              t(
                "seller.gate.unavailable",
                "Marketplace disabled in this county.\n\nYour products remain saved, but customers cannot place new orders until Marketplace is activated."
              )
          );
          return;
        }

        const seller = await loadOwnSeller();
        if (!mounted) return;

        if (!seller) {
          navigation.replace("SellerOnboarding");
          return;
        }

        navigation.replace("SellerDashboard");
      } catch (e) {
        console.log("SellerGate error:", e);
        if (mounted) {
          setMessage(
            t("seller.gate.error", "Unable to open seller area right now.")
          );
        }
      }
    };

    void routeSeller();

    return () => {
      mounted = false;
    };
  }, [navigation, t]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
      {message ? (
        <Text style={{ color: "#CBD5E1", textAlign: "center" }}>{message}</Text>
      ) : (
        <ActivityIndicator size="large" color="#A78BFA" />
      )}
    </View>
  );
}
