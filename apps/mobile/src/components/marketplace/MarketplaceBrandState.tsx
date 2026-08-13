import React from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_LINK_BLUE,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
} from "../../theme/mmdUi";

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");

type Props = {
  mode: "loading" | "empty" | "error";
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryLabel?: string;
};

/** Figma Marketplace loading/empty — logo 60 + brand + feedback (Customer App / Marketplace *). */
export function MarketplaceBrandState({
  mode,
  title,
  message,
  onRetry,
  retryLabel = "Retry",
}: Props) {
  return (
    <View
      style={styles.wrap}
      accessibilityRole={mode === "error" ? "alert" : "summary"}
    >
      <Image
        source={MMD_LOGO}
        style={styles.logo}
        resizeMode="contain"
        accessibilityLabel="MMD Delivery"
      />
      <Text style={styles.brand}>MMD Delivery</Text>
      {mode === "loading" ? (
        <>
          <Text style={styles.loadingMessage}>
            {message ?? "Loading marketplace..."}
          </Text>
          <View style={styles.feedback}>
            <ActivityIndicator color={MMD_LINK_BLUE} size="small" />
            <Text style={styles.feedbackTitle}>Loading…</Text>
          </View>
        </>
      ) : null}
      {mode === "empty" ? (
        <View style={styles.feedback}>
          <Text style={styles.emptyTitle}>
            {title ?? "No approved shops in your area yet."}
          </Text>
          {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
        </View>
      ) : null}
      {mode === "error" ? (
        <>
          <Text style={styles.errorTitle}>
            {title ?? "Couldn’t load marketplace"}
          </Text>
          {message ? <Text style={styles.emptyMessage}>{message}</Text> : null}
          {onRetry ? (
            <TouchableOpacity style={styles.retry} onPress={onRetry}>
              <Text style={styles.retryText}>{retryLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexGrow: 1,
    minHeight: 360,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
    paddingVertical: 40,
    backgroundColor: MMD_BLUE,
    gap: 16,
  },
  logo: { width: 60, height: 60, borderRadius: 30 },
  brand: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  loadingMessage: {
    color: MMD_TEXT_MUTED_BLUE,
    fontFamily: MMD_FONT.bold,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
  feedback: {
    width: 280,
    maxWidth: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 20,
  },
  feedbackTitle: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.bold,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyTitle: {
    color: MMD_TEXT,
    fontFamily: MMD_FONT.bold,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyMessage: {
    color: "#94A3B8",
    fontFamily: MMD_FONT.regular,
    fontSize: 15,
    textAlign: "center",
  },
  errorTitle: {
    color: "#FCA5A5",
    fontFamily: MMD_FONT.bold,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  retry: {
    marginTop: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: MMD_GOLD_CLASSIC,
  },
  retryText: {
    color: MMD_BLUE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
});

export default MarketplaceBrandState;
