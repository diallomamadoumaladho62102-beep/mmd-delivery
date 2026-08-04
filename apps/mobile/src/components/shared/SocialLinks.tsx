import React from "react";
import {
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import {
  getActiveSocialLinks,
  type SocialLinkDefinition,
} from "../../lib/socialLinks";

type Props = {
  style?: ViewStyle;
  links?: SocialLinkDefinition[];
  compact?: boolean;
  /** Use on dark screens (driver about, client settings). */
  tone?: "light" | "dark";
};

export function SocialLinks({
  style,
  links,
  compact = false,
  tone = "light",
}: Props) {
  const items = links ?? getActiveSocialLinks();
  if (!items.length) return null;
  const dark = tone === "dark";

  return (
    <View
      style={[styles.row, compact && styles.rowCompact, style]}
      accessibilityRole="summary"
      accessibilityLabel="MMD Delivery social media"
    >
      {items.map((link) => (
        <Pressable
          key={link.id}
          onPress={() => {
            void Linking.openURL(link.url);
          }}
          style={({ pressed }) => [
            styles.chip,
            dark && styles.chipDark,
            compact && styles.chipCompact,
            pressed && styles.chipPressed,
          ]}
          accessibilityRole="link"
          accessibilityLabel={`${link.label}${link.username ? ` ${link.username}` : ""}`}
        >
          <Text style={[styles.label, dark && styles.labelDark]}>
            {link.label}
          </Text>
          {link.username && !compact ? (
            <Text style={[styles.handle, dark && styles.handleDark]}>
              {link.username}
            </Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  rowCompact: {
    gap: 8,
  },
  chip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.35)",
    backgroundColor: "rgba(15,23,42,0.04)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 96,
  },
  chipDark: {
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  chipCompact: {
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chipPressed: {
    opacity: 0.75,
  },
  label: {
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "700",
  },
  labelDark: {
    color: "#E2E8F0",
  },
  handle: {
    marginTop: 2,
    color: "#64748b",
    fontSize: 11,
    fontWeight: "600",
  },
  handleDark: {
    color: "#94A3B8",
  },
});

export default SocialLinks;
