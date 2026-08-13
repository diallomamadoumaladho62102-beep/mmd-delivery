import React, { useEffect, useState } from "react";
import { Image, StatusBar, StyleSheet, Text, View } from "react-native";
import { supabase } from "../../lib/supabase";
import { loadOwnSeller, requireSellerPlatformEnabled } from "../../lib/sellerApi";
import { useTranslation } from "react-i18next";
import {
  SellerFeedbackCard,
  SellerGlassCard,
} from "../../components/seller/SellerChrome";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD,
  MMD_WHITE,
} from "../../theme/mmdUi";

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");

type Props = { navigation: any };

export default function SellerGateScreen({ navigation }: Props) {
  const { t } = useTranslation();
  const [message, setMessage] = useState<string | null>(null);
  const [restricted, setRestricted] = useState(false);

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
          setRestricted(true);
          setMessage(
            gate.message ??
              t(
                "seller.gate.unavailable",
                "Marketplace is disabled in this county. Your products remain saved, but customers cannot place new orders until Marketplace is activated."
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
          setRestricted(false);
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
    <View style={styles.root}>
      <StatusBar barStyle="light-content" />
      <Image
        source={MMD_LOGO}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="MMD Delivery"
      />

      {message ? (
        <>
          <SellerGlassCard style={styles.card}>
            <View style={styles.iconCircle}>
              <Text style={styles.icon}>{restricted ? "🚫" : "⚠️"}</Text>
            </View>
            <Text style={styles.title}>
              {restricted
                ? t("seller.gate.disabledTitle", "Marketplace Disabled")
                : t("seller.gate.errorTitle", "Seller unavailable")}
            </Text>
            <Text style={styles.body}>{message}</Text>
          </SellerGlassCard>
          {restricted ? (
            <View style={styles.pill}>
              <Text style={styles.pillText}>
                {t("seller.gate.regionRestricted", "REGION RESTRICTED")}
              </Text>
            </View>
          ) : null}
        </>
      ) : (
        <SellerFeedbackCard
          loading
          title={t("seller.gate.checking", "Checking Access...")}
          message={t(
            "seller.gate.verifying",
            "Verifying your seller account"
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: MMD_BLUE,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 24,
  },
  logo: {
    width: 64,
    height: 64,
    borderRadius: 16,
  },
  card: {
    width: "100%",
    alignItems: "center",
    gap: 16,
    padding: 40,
    borderRadius: 24,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  icon: { fontSize: 28 },
  title: {
    color: MMD_WHITE,
    fontSize: 22,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  body: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
    lineHeight: 21,
  },
  pill: {
    backgroundColor: "rgba(245,158,11,0.15)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.25)",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  pillText: {
    color: MMD_GOLD,
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    letterSpacing: 0.6,
  },
});
