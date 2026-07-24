import React, { useRef } from "react";
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useReduceMotion } from "../../hooks/useReduceMotion";

type Props = {
  showCall: boolean;
  calling: boolean;
  onCall: () => void;
  onChat: () => void;
  showShare: boolean;
  onShare: () => void;
  callLabel: string;
  callingLabel: string;
  chatLabel: string;
  shareLabel: string;
  callHint?: string;
  chatHint?: string;
  shareHint?: string;
};

function ActionButton({
  color,
  icon,
  label,
  hint,
  onPress,
  disabled,
  accessibilityLabel,
}: {
  color: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel: string;
}) {
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;

  const animate = (to: number) => {
    if (reduceMotion) return;
    Animated.spring(scale, {
      toValue: to,
      useNativeDriver: true,
      friction: 6,
      tension: 220,
    }).start();
  };

  return (
    <Animated.View style={{ flex: 1, transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={hint}
        disabled={disabled}
        onPressIn={() => animate(0.96)}
        onPressOut={() => animate(1)}
        onPress={onPress}
        style={[
          styles.btn,
          { backgroundColor: color, opacity: disabled ? 0.6 : 1 },
        ]}
      >
        <Ionicons name={icon} size={20} color="#FFFFFF" />
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        {hint ? (
          <Text style={styles.hint} numberOfLines={1}>
            {hint}
          </Text>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export const TrackingBottomActions = React.memo(function TrackingBottomActions({
  showCall,
  calling,
  onCall,
  onChat,
  showShare,
  onShare,
  callLabel,
  callingLabel,
  chatLabel,
  shareLabel,
  callHint,
  chatHint,
  shareHint,
}: Props) {
  // Home-indicator / nav-bar inset is applied by the parent ScrollView sheet.
  return (
    <View style={styles.row}>
      {showCall ? (
        <ActionButton
          color="#059669"
          icon="call"
          label={calling ? callingLabel : callLabel}
          hint={callHint}
          onPress={onCall}
          disabled={calling}
          accessibilityLabel={calling ? callingLabel : callLabel}
        />
      ) : null}
      <ActionButton
        color="#2563EB"
        icon="chatbubble-ellipses"
        label={chatLabel}
        hint={chatHint}
        onPress={onChat}
        accessibilityLabel={chatLabel}
      />
      {showShare ? (
        <ActionButton
          color="#7C3AED"
          icon="share-social"
          label={shareLabel}
          hint={shareHint}
          onPress={onShare}
          accessibilityLabel={shareLabel}
        />
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 10,
    paddingTop: 8,
  },
  btn: {
    minHeight: 60,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 8,
    gap: 2,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  label: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  hint: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 10,
    fontWeight: "600",
  },
});
