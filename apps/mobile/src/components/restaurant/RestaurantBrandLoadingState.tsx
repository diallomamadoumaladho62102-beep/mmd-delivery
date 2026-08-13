import React from "react";
import {
  ActivityIndicator,
  Image,
  Platform,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_CARD_BORDER,
  MMD_FONT,
  MMD_GLASS,
  MMD_GOLD_CLASSIC,
  MMD_TEXT,
  MMD_WHITE,
  mmdLogoSizeCompact,
} from "../../theme/mmdUi";

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");

type Props = {
  title: string;
  subtitle?: string;
  logoAtBottom?: boolean;
  /** Figma Lot 2/3 — centered navy loading card */
  variant?: "footer" | "card";
  /** Alias used by finance/menu screens — navy/glass centered card */
  glass?: boolean;
  /** Figma Gate Loading 343:5489 — navy card + footer brand */
  showCardLogo?: boolean;
  /** Shared chat loading — show brand logo in card */
  showLogo?: boolean;
};

/** Figma Restaurant loading — spinner/title + logo brand footer or navy card. */
export function RestaurantBrandLoadingState({
  title,
  subtitle,
  logoAtBottom = true,
  variant = "footer",
  glass = false,
  showCardLogo = false,
  showLogo = false,
}: Props) {
  const { width, height } = useWindowDimensions();
  const logoSize = Math.min(56, mmdLogoSizeCompact(width, height));
  const cardW = Math.min(280, width - 48);
  const useCard = glass || variant === "card" || showLogo;
  const useGate = showCardLogo;

  const footerBrand = (
    <View style={styles.brandBlock}>
      <Image
        source={MMD_LOGO}
        style={styles.footerLogo}
        resizeMode="contain"
        accessibilityLabel="MMD Delivery"
      />
      <Text style={styles.brandLabel}>MMD Delivery</Text>
    </View>
  );

  if (useGate) {
    return (
      <View style={styles.root}>
        <View style={styles.spacer} />
        <View style={[styles.gateCard, { width: cardW }]}>
          <Image
            source={MMD_LOGO}
            style={styles.gateCardLogo}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <ActivityIndicator color={MMD_WHITE} />
          <Text style={styles.gateTitle}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <View style={styles.spacer} />
        {footerBrand}
      </View>
    );
  }

  if (useCard) {
    const showBrand = showLogo || glass;
    return (
      <View style={styles.cardRoot}>
        <View style={styles.spacer} />
        <View style={[styles.loadingCard, glass && styles.glassCard]}>
          {showBrand ? (
            <>
              <Image
                source={MMD_LOGO}
                style={styles.cardLogo}
                resizeMode="contain"
                accessibilityLabel="MMD Delivery"
              />
              <Text style={styles.cardBrand}>MMD Delivery</Text>
            </>
          ) : null}
          <ActivityIndicator color={MMD_WHITE} size="large" />
          <Text style={styles.cardTitle}>{title}</Text>
          {subtitle ? <Text style={styles.cardSubtitle}>{subtitle}</Text> : null}
        </View>
        <View style={styles.spacer} />
      </View>
    );
  }

  const brand = (
    <View style={styles.brandBlock}>
      <Image
        source={MMD_LOGO}
        style={{
          width: logoSize,
          height: logoSize,
          borderRadius: logoSize / 2,
        }}
        resizeMode="contain"
        accessibilityLabel="MMD Delivery"
      />
      <Text style={styles.brandLabel}>MMD Delivery</Text>
    </View>
  );

  if (logoAtBottom) {
    return (
      <View style={styles.root}>
        <View style={styles.feedback}>
          <ActivityIndicator color={MMD_TEXT} />
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <View style={styles.spacer} />
        {brand}
      </View>
    );
  }

  return (
    <View style={[styles.root, styles.centered]}>
      {brand}
      <View style={{ height: 20 }} />
      <ActivityIndicator color={MMD_TEXT} />
      <Text style={[styles.title, { marginTop: 12 }]}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: MMD_BLUE,
    paddingHorizontal: 24,
    paddingBottom: 40,
    alignItems: "center",
  },
  centered: {
    justifyContent: "center",
    paddingBottom: 16,
  },
  feedback: {
    marginTop: 100,
    alignItems: "center",
    gap: 10,
    padding: 20,
    maxWidth: 300,
  },
  title: {
    color: MMD_TEXT,
    fontSize: 18,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
    lineHeight: 18,
  },
  spacer: { flex: 1 },
  brandBlock: { alignItems: "center", gap: 8 },
  footerLogo: {
    width: 40,
    height: 40,
    borderRadius: 10,
  },
  brandLabel: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  gateCard: {
    backgroundColor: MMD_ACTION_NAVY,
    borderWidth: 1,
    borderColor: MMD_CARD_BORDER,
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    gap: 16,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.25,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 12 },
      },
      android: { elevation: 8 },
      default: {},
    }),
  },
  gateCardLogo: {
    width: 64,
    height: 64,
    borderRadius: 14,
  },
  gateTitle: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    textAlign: "center",
  },
  cardRoot: {
    flex: 1,
    width: "100%",
    backgroundColor: MMD_BLUE,
    alignItems: "center",
    paddingHorizontal: 24,
  },
  loadingCard: {
    width: 300,
    maxWidth: "100%",
    alignItems: "center",
    gap: 20,
    paddingHorizontal: 32,
    paddingVertical: 40,
    borderRadius: 20,
    backgroundColor: MMD_ACTION_NAVY,
    borderWidth: 1,
    borderColor: MMD_CARD_BORDER,
    overflow: "hidden",
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.2,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 12 },
      },
      android: { elevation: 10 },
      default: {},
    }),
  },
  glassCard: {
    backgroundColor: MMD_GLASS,
    borderColor: "rgba(255,255,255,0.12)",
  },
  cardLogo: {
    width: 72,
    height: 72,
    borderRadius: 16,
  },
  cardBrand: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 20,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  cardTitle: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    textAlign: "center",
  },
  cardSubtitle: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
    textAlign: "center",
  },
});

export default RestaurantBrandLoadingState;
