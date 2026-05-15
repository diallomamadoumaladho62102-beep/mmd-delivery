// apps/mobile/src/screens/DriverHelpScreen.tsx
import React, { useCallback, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Linking,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";

const BG = "#020617";
const CARD = "rgba(15,23,42,0.82)";
const CARD_DEEP = "rgba(2,6,23,0.72)";
const BORDER = "rgba(148,163,184,0.14)";
const PURPLE = "#A78BFA";
const BLUE = "#60A5FA";
const GREEN = "#22C55E";
const ORANGE = "#F97316";
const RED = "#F87171";
const TEXT = "#F8FAFC";
const MUTED = "#94A3B8";

const SUPPORT_EMAIL = "support@mmd-delivery.com";
const EMERGENCY_NUMBER = "911";

type HelpTone = "purple" | "blue" | "green" | "orange" | "red";

type HelpItemProps = {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  tone?: HelpTone;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
};

function toneColor(tone?: HelpTone) {
  if (tone === "blue") return BLUE;
  if (tone === "green") return GREEN;
  if (tone === "orange") return ORANGE;
  if (tone === "red") return RED;
  return PURPLE;
}

async function openSupportedUrl(url: string) {
  const supported = await Linking.canOpenURL(url);

  if (!supported) {
    throw new Error("unsupported_url");
  }

  await Linking.openURL(url);
}

function HelpItem({
  icon,
  title,
  subtitle,
  onPress,
  tone,
  disabled,
  loading,
  accessibilityLabel,
}: HelpItemProps) {
  const color = toneColor(tone);

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.86}
      style={[styles.helpItem, (disabled || loading) && styles.disabledItem]}
      accessible
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || title}
      accessibilityHint={subtitle}
    >
      <View
        style={[
          styles.itemIconBox,
          {
            borderColor: `${color}55`,
            backgroundColor: `${color}18`,
          },
        ]}
      >
        {loading ? (
          <ActivityIndicator color={color} />
        ) : (
          <Text style={[styles.itemIcon, { color }]}>{icon}</Text>
        )}
      </View>

      <View style={styles.itemTextWrap}>
        <Text style={styles.itemTitle}>{title}</Text>
        <Text style={styles.itemSubtitle}>{subtitle}</Text>
      </View>

      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  );
}

function FaqRow({ question, answer }: { question: string; answer: string }) {
  return (
    <View style={styles.faqRow}>
      <Text style={styles.faqQuestion}>{question}</Text>
      <Text style={styles.faqAnswer}>{answer}</Text>
    </View>
  );
}

export function DriverHelpScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const [busyAction, setBusyAction] = useState<"mail" | "emergency" | "chat" | "report" | null>(
    null
  );

  const runBusyAction = useCallback(
    async (key: "mail" | "emergency" | "chat" | "report", action: () => Promise<void> | void) => {
      if (busyAction) return;

      try {
        setBusyAction(key);
        await action();
      } finally {
        setBusyAction(null);
      }
    },
    [busyAction]
  );

  const openMail = useCallback(() => {
    void runBusyAction("mail", async () => {
      const subject = encodeURIComponent(
        t("driver.help.emailSubject", "MMD Delivery Driver Support")
      );

      const body = encodeURIComponent(
        t(
          "driver.help.emailBody",
          "Hello MMD Support,\n\nI need help with:\n\nOrder ID:\nIssue:\nPhone:\n\nThank you."
        )
      );

      const url = `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;

      try {
        await openSupportedUrl(url);
      } catch {
        Alert.alert(
          t("driver.help.emailErrorTitle", "Email"),
          t("driver.help.emailErrorBody", "Unable to open email app on this device.")
        );
      }
    });
  }, [runBusyAction, t]);

  const callEmergency = useCallback(() => {
    if (busyAction) return;

    Alert.alert(
      t("driver.help.emergencyConfirmTitle", "Emergency support"),
      t(
        "driver.help.emergencyConfirmBody",
        "For immediate danger or medical/police/fire emergency, call 911. For non-emergency delivery issues, use chat or email support."
      ),
      [
        {
          text: t("common.cancel", "Cancel"),
          style: "cancel",
        },
        {
          text: t("driver.help.callNow", "Call now"),
          style: "destructive",
          onPress: () => {
            void runBusyAction("emergency", async () => {
              try {
                await openSupportedUrl(`tel:${EMERGENCY_NUMBER}`);
              } catch {
                Alert.alert(
                  t("driver.help.callErrorTitle", "Phone"),
                  t("driver.help.callErrorBody", "Unable to open phone app.")
                );
              }
            });
          },
        },
      ]
    );
  }, [busyAction, runBusyAction, t]);

  const openAdminChat = useCallback(() => {
    void runBusyAction("chat", async () => {
      try {
        navigation.navigate("DriverChat", {
          orderId: "support",
          targetRole: "admin",
        });
        return;
      } catch {
        Alert.alert(
          t("driver.help.comingSoonTitle", "Coming soon ✅"),
          t("driver.help.adminChatSoon", "Admin support chat will be available soon.")
        );
      }
    });
  }, [navigation, runBusyAction, t]);

  const reportIssue = useCallback(() => {
    void runBusyAction("report", async () => {
      try {
        navigation.navigate("DriverReportIssue");
      } catch {
        Alert.alert(
          t("driver.help.reportIssueTitle", "Report issue"),
          t(
            "driver.help.reportIssueBody",
            "For now, please contact support by email with the order ID and details."
          )
        );
      }
    });
  }, [navigation, runBusyAction, t]);

  const busy = busyAction !== null;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.headerWrap}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            disabled={busy}
            style={[styles.roundButton, busy && styles.disabledItem]}
            activeOpacity={0.85}
            accessible
            accessibilityRole="button"
            accessibilityLabel={t("common.back", "Back")}
          >
            <Text style={styles.backText}>←</Text>
          </TouchableOpacity>

          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>{t("driver.help.title", "Help")}</Text>
            <Text style={styles.headerSub}>
              {t("driver.help.subtitle", "Support, FAQ, emergency help and reports.")}
            </Text>
          </View>

          <View style={styles.roundButtonGhost} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View style={styles.flex}>
            <Text style={styles.heroLabel}>{t("driver.help.heroLabel", "MMD DRIVER SUPPORT")}</Text>
            <Text style={styles.heroTitle}>{t("driver.help.heroTitle", "How can we help?")}</Text>
            <Text style={styles.heroSub}>
              {t(
                "driver.help.heroSub",
                "Get help with orders, payouts, account verification, safety, and app issues."
              )}
            </Text>
          </View>

          <View style={styles.heroIconBox}>
            <Text style={styles.heroIcon}>?</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>{t("driver.help.supportSection", "Support")}</Text>

        <HelpItem
          icon="💬"
          title={t("driver.help.chatSupport", "Chat support")}
          subtitle={t("driver.help.chatSupportSub", "Contact MMD admin support.")}
          onPress={openAdminChat}
          tone="purple"
          disabled={busy}
          loading={busyAction === "chat"}
          accessibilityLabel={t("driver.help.chatSupport", "Chat support")}
        />

        <HelpItem
          icon="✉"
          title={t("driver.help.emailSupport", "Email support")}
          subtitle={t("driver.help.emailSupportSub", "Send details, screenshots, or an order ID.")}
          onPress={openMail}
          tone="blue"
          disabled={busy}
          loading={busyAction === "mail"}
          accessibilityLabel={t("driver.help.emailSupport", "Email support")}
        />

        <HelpItem
          icon="⚠"
          title={t("driver.help.reportIssue", "Report an issue")}
          subtitle={t(
            "driver.help.reportIssueSub",
            "Problem with order, payment, GPS, customer, or restaurant."
          )}
          onPress={reportIssue}
          tone="orange"
          disabled={busy}
          loading={busyAction === "report"}
          accessibilityLabel={t("driver.help.reportIssue", "Report an issue")}
        />

        <HelpItem
          icon="SOS"
          title={t("driver.help.emergency", "Emergency")}
          subtitle={t("driver.help.emergencySub", "Urgent delivery or safety issue.")}
          onPress={callEmergency}
          tone="red"
          disabled={busy}
          loading={busyAction === "emergency"}
          accessibilityLabel={t("driver.help.emergency", "Emergency")}
        />

        <Text style={styles.sectionTitle}>{t("driver.help.faqSection", "FAQ")}</Text>

        <View style={styles.faqCard}>
          <FaqRow
            question={t("driver.help.faq.cashoutQ", "Why can’t I cash out?")}
            answer={t(
              "driver.help.faq.cashoutA",
              "Make sure Stripe is fully enabled, your balance reached the minimum, and you have not already cashed out today."
            )}
          />

          <FaqRow
            question={t("driver.help.faq.orderQ", "What should I do if an order has a problem?")}
            answer={t(
              "driver.help.faq.orderA",
              "Open the order, use the chat, and report the issue with the order ID."
            )}
          />

          <FaqRow
            question={t("driver.help.faq.gpsQ", "Why is GPS not updating?")}
            answer={t(
              "driver.help.faq.gpsA",
              "Check location permissions, keep the app open, and make sure you are online."
            )}
          />

          <FaqRow
            question={t("driver.help.faq.documentsQ", "Why is my account not complete?")}
            answer={t(
              "driver.help.faq.documentsA",
              "Go to Account and complete documents, vehicle info, and payout setup."
            )}
          />
        </View>

        <View style={styles.footerCard}>
          <Text style={styles.footerTitle}>
            {t("driver.help.footerTitle", "Before contacting support")}
          </Text>
          <Text style={styles.footerText}>
            {t(
              "driver.help.footerText",
              "Prepare your order ID, screenshot, phone number, and a short explanation. This helps MMD solve the issue faster."
            )}
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BG },
  flex: { flex: 1 },
  headerWrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 6,
  },
  headerRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  roundButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: CARD_DEEP,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: "center",
    justifyContent: "center",
  },
  roundButtonGhost: {
    width: 42,
    height: 42,
  },
  backText: {
    color: "#BFDBFE",
    fontSize: 18,
    fontWeight: "900",
  },
  headerCenter: {
    flex: 1,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  headerTitle: {
    color: TEXT,
    fontSize: 18,
    fontWeight: "900",
  },
  headerSub: {
    color: MUTED,
    marginTop: 2,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 30,
  },
  heroCard: {
    borderRadius: 28,
    padding: 18,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.22)",
    flexDirection: "row",
    alignItems: "center",
    shadowColor: "#8B5CF6",
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  heroLabel: {
    color: PURPLE,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  heroTitle: {
    color: TEXT,
    fontSize: 28,
    fontWeight: "900",
    marginTop: 6,
  },
  heroSub: {
    color: "#CBD5E1",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    marginTop: 8,
  },
  heroIconBox: {
    width: 64,
    height: 64,
    borderRadius: 24,
    backgroundColor: "rgba(139,92,246,0.16)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.3)",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 14,
  },
  heroIcon: {
    color: PURPLE,
    fontSize: 32,
    fontWeight: "900",
  },
  sectionTitle: {
    color: TEXT,
    fontSize: 22,
    fontWeight: "900",
    marginTop: 20,
    marginBottom: 10,
  },
  helpItem: {
    minHeight: 78,
    borderRadius: 22,
    padding: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  disabledItem: {
    opacity: 0.62,
  },
  itemIconBox: {
    width: 46,
    height: 46,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  itemIcon: {
    fontSize: 18,
    fontWeight: "900",
  },
  itemTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  itemTitle: {
    color: TEXT,
    fontSize: 16,
    fontWeight: "900",
  },
  itemSubtitle: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
    lineHeight: 17,
  },
  chevron: {
    color: "#CBD5E1",
    fontSize: 28,
    fontWeight: "700",
    marginLeft: 8,
  },
  faqCard: {
    borderRadius: 24,
    padding: 14,
    backgroundColor: CARD,
    borderWidth: 1,
    borderColor: BORDER,
  },
  faqRow: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(148,163,184,0.1)",
  },
  faqQuestion: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "900",
  },
  faqAnswer: {
    color: MUTED,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 6,
  },
  footerCard: {
    marginTop: 14,
    borderRadius: 22,
    padding: 14,
    backgroundColor: "rgba(139,92,246,0.10)",
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.20)",
  },
  footerTitle: {
    color: "#DDD6FE",
    fontSize: 14,
    fontWeight: "900",
  },
  footerText: {
    color: "#C4B5FD",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 6,
  },
});
