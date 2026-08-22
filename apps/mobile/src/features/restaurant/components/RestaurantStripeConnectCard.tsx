import React, { useCallback, useMemo, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { supabase } from "../../../lib/supabase";
import {
  deriveRestaurantConnectStatus,
  restaurantStripeConnectCta,
} from "../../../lib/stripeConnectStatus";
import { logTechnicalError, toUserFacingError } from "../../../lib/userFacingError";
import { startStripeOnboarding } from "../../../utils/stripe";
import {
  MMD_FONT,
  MMD_GLASS,
  MMD_TAXI_GREEN,
  MMD_TEXT,
  MMD_WHITE,
} from "../../../theme/mmdUi";

type Props = {
  heldAmountLabel?: string | null;
};

/**
 * Official Stripe Express CTA. Bank / KYC fields stay on Stripe — never in-app.
 */
export function RestaurantStripeConnectCard({ heldAmountLabel }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [statusCode, setStatusCode] = useState(
    deriveRestaurantConnectStatus(null),
  );
  const [blockedReason, setBlockedReason] = useState<string | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const { data: connectData, error: connectErr } = await supabase.functions.invoke(
        "check_connect_status",
        {
          body: { role: "restaurant" },
          headers: { Authorization: `Bearer ${session.access_token}` },
        },
      );
      if (connectErr) {
        logTechnicalError("restaurant.connect.check_connect_status", connectErr);
      }

      const { data: profile } = await supabase
        .from("restaurant_profiles")
        .select(
          "stripe_account_id,stripe_onboarding_status,stripe_charges_enabled,stripe_payouts_enabled,stripe_details_submitted",
        )
        .eq("user_id", session.user.id)
        .maybeSingle();

      const connect = (connectData ?? {}) as Record<string, unknown>;
      const merged = {
        stripe_account_id:
          connect.stripe_account_id != null
            ? String(connect.stripe_account_id)
            : profile?.stripe_account_id ?? null,
        stripe_onboarding_status:
          typeof connect.status === "string"
            ? connect.status
            : profile?.stripe_onboarding_status ?? null,
        stripe_charges_enabled:
          typeof connect.charges_enabled === "boolean"
            ? connect.charges_enabled
            : profile?.stripe_charges_enabled ?? null,
        stripe_payouts_enabled:
          typeof connect.payouts_enabled === "boolean"
            ? connect.payouts_enabled
            : profile?.stripe_payouts_enabled ?? null,
        stripe_details_submitted:
          typeof connect.details_submitted === "boolean"
            ? connect.details_submitted
            : profile?.stripe_details_submitted ?? null,
      };

      setAccountId(String(merged.stripe_account_id ?? "").trim() || null);
      setStatusCode(deriveRestaurantConnectStatus(merged));

      const reason = String(connect.disabled_reason ?? "").trim();
      const pastDue = Array.isArray(connect.past_due) ? connect.past_due : [];
      const currentlyDue = Array.isArray(connect.currently_due)
        ? connect.currently_due
        : [];
      if (reason) {
        setBlockedReason(reason);
      } else if (pastDue.length > 0 || currentlyDue.length > 0) {
        setBlockedReason(
          t(
            "restaurant.earnings.stripe.moreInfoNeeded",
            "Stripe still needs identity or bank information.",
          ),
        );
      } else {
        setBlockedReason(null);
      }
    } catch (e) {
      logTechnicalError("restaurant.connect.refreshStatus", e);
    }
  }, [t]);

  useFocusEffect(
    useCallback(() => {
      void refreshStatus();
    }, [refreshStatus]),
  );

  const cta = useMemo(() => restaurantStripeConnectCta(statusCode), [statusCode]);
  const ready = statusCode === "ready_for_payouts" && Boolean(accountId);

  async function openStripeExpress() {
    if (loading) return;
    try {
      setLoading(true);
      await startStripeOnboarding("restaurant");
      await refreshStatus();
    } catch (e) {
      Alert.alert(
        t("common.error", "Erreur"),
        toUserFacingError(
          e,
          t(
            "restaurant.earnings.errors.openStripe",
            "Impossible d’ouvrir Stripe Connect.",
          ),
        ),
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.card} testID="restaurant-connect-stripe-card">
      <Text style={styles.kicker}>
        {t("restaurant.earnings.stripe.bankKicker", "Bank payouts")}
      </Text>
      <Text style={styles.title}>{cta.title}</Text>
      <Text style={styles.body}>{cta.body}</Text>
      {!ready && heldAmountLabel ? (
        <Text style={styles.held}>
          {t(
            "restaurant.earnings.stripe.heldLine",
            "{{amount}} is waiting until Stripe Connect is complete. It is not paid yet.",
            { amount: heldAmountLabel },
          )}
        </Text>
      ) : null}
      {blockedReason && !ready ? (
        <Text style={styles.reason}>
          {t("restaurant.earnings.stripe.blockedReason", "Reason: {{reason}}", {
            reason: blockedReason,
          })}
        </Text>
      ) : null}
      <TouchableOpacity
        style={[styles.cta, loading && { opacity: 0.7 }]}
        disabled={loading}
        onPress={() => void openStripeExpress()}
        accessibilityRole="button"
        accessibilityLabel={cta.action}
        testID="restaurant-connect-stripe"
      >
        <Text style={styles.ctaLabel}>
          {loading ? t("common.loading", "Loading…") : cta.action}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: "100%",
    backgroundColor: MMD_GLASS,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 20,
    padding: 24,
    gap: 10,
  },
  kicker: {
    color: MMD_TAXI_GREEN,
    fontSize: 12,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  title: {
    color: MMD_TEXT,
    fontSize: 20,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  body: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
  },
  held: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  reason: {
    color: "#FCA5A5",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
  },
  cta: {
    backgroundColor: MMD_TAXI_GREEN,
    minHeight: 48,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  ctaLabel: {
    color: MMD_WHITE,
    fontSize: 15,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
});
