import React from "react";
import {
  Modal,
  View,
  Text,
  Pressable,
  StyleSheet,
  Platform,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { V4, V4_RADIUS } from "./clientHomeTheme";

type TsFn = (key: string, fallback: string, params?: Record<string, unknown>) => string;

type Props = {
  visible: boolean;
  ts: TsFn;
  onClose: () => void;
  onOrderFood: () => void;
  onBookTaxi: () => void;
  onSendPackage: () => void;
  onContactSupport: () => void;
};

function SheetAction({
  label,
  subtitle,
  onPress,
  testID,
}: {
  label: string;
  subtitle?: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.actionRow, pressed && styles.actionRowPressed]}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      hitSlop={8}
    >
      <View style={styles.actionCopy}>
        <Text style={styles.actionLabel}>{label}</Text>
        {subtitle ? <Text style={styles.actionSub}>{subtitle}</Text> : null}
      </View>
      <Text style={styles.actionChevron}>›</Text>
    </Pressable>
  );
}

export function ClientHomeAiSheet({
  visible,
  ts,
  onClose,
  onOrderFood,
  onBookTaxi,
  onSendPackage,
  onContactSupport,
}: Props) {
  const insets = useSafeAreaInsets();

  const runAndClose = (action: () => void) => {
    onClose();
    action();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      testID="client-home-ai-sheet"
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close MMD AI sheet">
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}
          onPress={(event) => event.stopPropagation()}
        >
          <View style={styles.handle} />

          <View style={styles.heroIcon}>
            <Text style={styles.heroIconGlyph}>◆</Text>
          </View>

          <Text style={styles.title}>{ts("client.home.v4.ai.title", "Ask MMD AI")}</Text>
          <Text style={styles.subtitle}>
            {ts(
              "client.home.v4.ai.comingSoonTitle",
              "MMD AI is coming soon"
            )}
          </Text>
          <Text style={styles.body}>
            {ts(
              "client.home.v4.ai.comingSoonBody",
              "Smart ordering, ride booking, and live support will arrive in a future update. Use the shortcuts below for now."
            )}
          </Text>

          <View style={styles.actions}>
            <SheetAction
              label={ts("client.home.v4.ai.orderFood", "Order food")}
              subtitle={ts("client.home.banner.restaurant.title", "Food")}
              onPress={() => runAndClose(onOrderFood)}
              testID="client-home-ai-order-food"
            />
            <SheetAction
              label={ts("client.home.v4.ai.bookTaxi", "Book a taxi")}
              subtitle={ts("client.home.banner.taxi.title", "Taxi")}
              onPress={() => runAndClose(onBookTaxi)}
              testID="client-home-ai-book-taxi"
            />
            <SheetAction
              label={ts("client.home.v4.ai.sendPackage", "Send a package")}
              subtitle={ts("client.home.banner.delivery.title", "Delivery")}
              onPress={() => runAndClose(onSendPackage)}
              testID="client-home-ai-send-package"
            />
            <SheetAction
              label={ts("client.home.v4.ai.contactSupport", "Contact support")}
              subtitle={ts("client.home.v4.inbox", "Inbox")}
              onPress={() => runAndClose(onContactSupport)}
              testID="client-home-ai-contact-support"
            />
          </View>

          <Pressable
            onPress={onClose}
            style={styles.dismissButton}
            accessibilityRole="button"
            accessibilityLabel={ts("common.close", "Close")}
            testID="client-home-ai-close"
            hitSlop={10}
          >
            <Text style={styles.dismissText}>{ts("common.close", "Close")}</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.78)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: V4_RADIUS.lg,
    borderTopRightRadius: V4_RADIUS.lg,
    backgroundColor: V4.card,
    borderWidth: 1,
    borderColor: V4.border,
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  handle: {
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignSelf: "center",
    marginBottom: 16,
  },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(0,217,95,0.14)",
    borderWidth: 1,
    borderColor: V4.borderGreen,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  heroIconGlyph: { color: V4.green, fontSize: 22, fontWeight: "900" },
  title: { color: V4.textPrimary, fontSize: 22, fontWeight: "900" },
  subtitle: { color: V4.green, fontSize: 14, fontWeight: "800", marginTop: 6 },
  body: {
    color: V4.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 10,
    marginBottom: 16,
  },
  actions: { gap: 8 },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: V4_RADIUS.sm,
    backgroundColor: V4.cardSecondary,
    borderWidth: 1,
    borderColor: V4.border,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === "android" ? 12 : 14,
  },
  actionRowPressed: { opacity: 0.88 },
  actionCopy: { flex: 1, minWidth: 0, paddingRight: 8 },
  actionLabel: { color: V4.textPrimary, fontWeight: "900", fontSize: 15 },
  actionSub: { color: V4.textSecondary, fontSize: 11, marginTop: 2, fontWeight: "600" },
  actionChevron: { color: V4.textSecondary, fontSize: 20, fontWeight: "700" },
  dismissButton: {
    marginTop: 14,
    alignItems: "center",
    paddingVertical: 12,
  },
  dismissText: { color: V4.textSecondary, fontWeight: "800", fontSize: 14 },
});
