import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { MMD_FONT, MMD_GOLD_BRIGHT, MMD_NAVY, MMD_WHITE } from "../../theme/mmdUi";

type PlatformPayButtonComponent = React.ComponentType<{
  type?: number;
  appearance?: number;
  borderRadius?: number;
  disabled?: boolean;
  onPress: () => void;
  style?: object;
  accessibilityLabel?: string;
}>;

type Props = {
  disabled?: boolean;
  loading?: boolean;
  applePayAvailable: boolean;
  onPayWithCard: () => void;
  onPayWithApplePay: () => void;
};

export function ClientCheckoutPaymentMethods({
  disabled = false,
  loading = false,
  applePayAvailable,
  onPayWithCard,
  onPayWithApplePay,
}: Props) {
  const { t } = useTranslation();
  const [ApplePayButton, setApplePayButton] =
    useState<PlatformPayButtonComponent | null>(null);

  useEffect(() => {
    if (!applePayAvailable) {
      setApplePayButton(null);
      return;
    }
    let alive = true;
    void import("@stripe/stripe-react-native")
      .then((mod) => {
        if (alive && mod.PlatformPayButton) {
          setApplePayButton(() => mod.PlatformPayButton as PlatformPayButtonComponent);
        }
      })
      .catch(() => {
        if (alive) setApplePayButton(null);
      });
    return () => {
      alive = false;
    };
  }, [applePayAvailable]);

  const busy = disabled || loading;

  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <Text style={styles.title}>
        {t("checkout.payment.title", "Payment")}
      </Text>

      <TouchableOpacity
        onPress={onPayWithCard}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={t("checkout.payment.card", "Card")}
        style={[styles.cardButton, busy && styles.disabled]}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator color={MMD_NAVY} />
        ) : (
          <Text style={styles.cardLabel}>
            {t("checkout.payment.card", "Card")}
          </Text>
        )}
      </TouchableOpacity>

      {applePayAvailable ? (
        ApplePayButton ? (
          <ApplePayButton
            type={0}
            appearance={2}
            borderRadius={14}
            disabled={busy}
            onPress={onPayWithApplePay}
            style={[styles.applePayButton, busy && styles.disabled]}
            accessibilityLabel={t("checkout.payment.applePay", "Apple Pay")}
          />
        ) : (
          <View style={styles.applePayPlaceholder}>
            <ActivityIndicator color={MMD_WHITE} />
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 10,
    marginTop: 8,
  },
  title: {
    color: MMD_WHITE,
    fontSize: 16,
    fontWeight: "800",
    fontFamily: MMD_FONT.bold,
    marginBottom: 4,
  },
  cardButton: {
    backgroundColor: MMD_GOLD_BRIGHT,
    borderRadius: 14,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
  },
  cardLabel: {
    color: MMD_NAVY,
    fontSize: 16,
    fontWeight: "700",
    fontFamily: MMD_FONT.bold,
  },
  applePayButton: {
    width: "100%",
    height: 48,
  },
  applePayPlaceholder: {
    height: 48,
    borderRadius: 14,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  disabled: {
    opacity: 0.55,
  },
});
