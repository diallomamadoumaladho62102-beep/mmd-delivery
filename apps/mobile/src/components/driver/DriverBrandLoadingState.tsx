import React from "react";
import {
  ActivityIndicator,
  Image,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import {
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_TEXT,
  mmdLogoSizeCompact,
} from "../../theme/mmdUi";

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");

type Props = {
  title: string;
  /** When true, logo sits at bottom (Figma Driver Auth Loading). */
  logoAtBottom?: boolean;
};

/**
 * Figma Driver loading surfaces — spinner + title, logo + "MMD Delivery".
 */
export function DriverBrandLoadingState({
  title,
  logoAtBottom = true,
}: Props) {
  const { width, height } = useWindowDimensions();
  const logoSize = Math.min(50, mmdLogoSizeCompact(width, height));

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
          <ActivityIndicator color={MMD_TEXT} size="small" />
          <Text style={styles.title}>{title}</Text>
        </View>
        <View style={styles.spacer} />
        {brand}
      </View>
    );
  }

  return (
    <View style={[styles.root, styles.centered]}>
      {brand}
      <View style={{ height: 24 }} />
      <ActivityIndicator color={MMD_TEXT} />
      <Text style={[styles.title, { marginTop: 12 }]}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: MMD_BLUE,
    paddingHorizontal: 16,
    paddingBottom: 50,
    alignItems: "center",
  },
  centered: {
    justifyContent: "center",
    paddingBottom: 16,
  },
  feedback: {
    marginTop: 80,
    alignItems: "center",
    gap: 8,
    padding: 20,
  },
  title: {
    color: MMD_TEXT,
    fontSize: 20,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  spacer: {
    flex: 1,
  },
  brandBlock: {
    alignItems: "center",
    gap: 8,
  },
  brandLabel: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
});

export default DriverBrandLoadingState;
