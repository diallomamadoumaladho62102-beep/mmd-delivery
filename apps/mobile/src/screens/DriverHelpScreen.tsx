// apps/mobile/src/screens/DriverHelpScreen.tsx
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Linking,
  Alert,
  ActivityIndicator,
  Image,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { SocialLinks } from "../components/shared/SocialLinks";
import { getActiveSocialLinks } from "../lib/socialLinks";
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_WHITE,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");
const SUPPORT_EMAIL = "support@mmddelivery.com";
const EMERGENCY_NUMBER = "911";

type BusyAction = "mail" | "emergency" | "chat" | "report";

type HelpItemProps = {
  icon: string;
  title: string;
  subtitle: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  showDivider?: boolean;
  accessibilityLabel?: string;
};

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
  disabled,
  loading,
  showDivider,
  accessibilityLabel,
}: HelpItemProps) {
  const isDisabled = disabled || loading;

  return (
    <>
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.86}
        style={[styles.helpItem, isDisabled && styles.disabledItem]}
        accessible
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || title}
        accessibilityHint={subtitle}
        accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      >
        {loading ? (
          <ActivityIndicator color={MMD_WHITE} style={styles.itemIcon} />
        ) : (
          <Text style={styles.itemIcon}>{icon}</Text>
        )}

        <View style={styles.itemTextWrap}>
          <Text style={styles.itemTitle}>{title}</Text>
          <Text style={styles.itemSubtitle}>{subtitle}</Text>
        </View>

        <Text style={styles.chevron}>›</Text>
      </TouchableOpacity>
      {showDivider ? <View style={styles.rowDivider} /> : null}
    </>
  );
}

function FaqRow({
  question,
  answer,
  showDivider,
}: {
  question: string;
  answer: string;
  showDivider?: boolean;
}) {
  return (
    <>
      <View style={styles.faqRow}>
        <Text style={styles.faqQuestion}>{question}</Text>
        <Text style={styles.faqAnswer}>{answer}</Text>
      </View>
      {showDivider ? <View style={styles.rowDivider} /> : null}
    </>
  );
}

export function DriverHelpScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);

  const instagramLinks = useMemo(
    () =>
      getActiveSocialLinks().filter(
        (link) =>
          link.id === "instagram" ||
          /instagram/i.test(link.label) ||
          /instagram\.com/i.test(link.url)
      ),
    []
  );

  const runBusyAction = useCallback(
    async (key: BusyAction, action: () => Promise<void> | void) => {
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
          sourceTable: "support",
        });
      } catch (e: any) {
        console.error("[DriverHelpScreen] admin chat open failed", e);

        Alert.alert(
          t("shared.orderChat.alerts.errorTitle", "Error"),
          e?.message ||
            t(
              "driver.help.chatOpenError",
              "Unable to open admin support chat."
            )
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
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("driver.help.title", "Help")}
        subtitle={t("driver.help.subtitleShort", "Support, FAQ & emergency")}
        fallbackRoute="DriverTabs"
        variant="mmd"
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.heroCard}>
          <View style={styles.flex}>
            <Text style={styles.heroLabel}>
              {t("driver.help.heroLabel", "MMD DRIVER SUPPORT")}
            </Text>
            <Text style={styles.heroTitle}>
              {t("driver.help.heroTitle", "How can we help?")}
            </Text>
            <Text style={styles.heroSub}>
              {t(
                "driver.help.heroSubShort",
                "Get help with orders, payouts, account, safety."
              )}
            </Text>
          </View>

          <Image
            source={MMD_LOGO}
            style={styles.heroLogo}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
        </View>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            {t("driver.help.supportSection", "Support")}
          </Text>
          <View style={styles.sectionDivider} />
        </View>

        <HelpItem
          icon="💬"
          title={t("driver.help.chatSupport", "Chat Support")}
          subtitle={t("driver.help.chatSupportSub", "Contact MMD admin support.")}
          onPress={openAdminChat}
          disabled={busy}
          loading={busyAction === "chat"}
          showDivider
        />

        <HelpItem
          icon="📧"
          title={t("driver.help.emailSupport", "Email Support")}
          subtitle={t(
            "driver.help.emailSupportSubShort",
            "Send details, screenshots, or order ID."
          )}
          onPress={openMail}
          disabled={busy}
          loading={busyAction === "mail"}
          showDivider
        />

        <HelpItem
          icon="🚨"
          title={t("driver.help.reportIssue", "Report an Issue")}
          subtitle={t(
            "driver.help.reportIssueSubShort",
            "Problem with order, payment, GPS."
          )}
          onPress={reportIssue}
          disabled={busy}
          loading={busyAction === "report"}
          showDivider
        />

        <HelpItem
          icon="🆘"
          title={t("driver.help.emergency", "Emergency")}
          subtitle={t("driver.help.emergencySub", "Urgent delivery or safety issue.")}
          onPress={callEmergency}
          disabled={busy}
          loading={busyAction === "emergency"}
        />

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>
            {t("driver.help.faqSection", "FAQ")}
          </Text>
          <View style={styles.sectionDivider} />
        </View>

        <FaqRow
          question={t("driver.help.faq.cashoutQ", "Why can't I cash out?")}
          answer={t(
            "driver.help.faq.cashoutAShort",
            "Make sure Stripe is enabled and balance reached the minimum."
          )}
          showDivider
        />

        <FaqRow
          question={t("driver.help.faq.orderQShort", "Order has a problem?")}
          answer={t(
            "driver.help.faq.orderAShort",
            "Open the order, use chat, report with order ID."
          )}
          showDivider
        />

        <FaqRow
          question={t("driver.help.faq.gpsQShort", "GPS not updating?")}
          answer={t(
            "driver.help.faq.gpsAShort",
            "Check location permissions, keep app open."
          )}
          showDivider
        />

        <FaqRow
          question={t("driver.help.faq.documentsQShort", "Account not complete?")}
          answer={t(
            "driver.help.faq.documentsAShort",
            "Go to Account, complete documents and payout."
          )}
        />

        <View style={styles.tipCard}>
          <View style={styles.tipIconBox}>
            <Text style={styles.tipIcon}>📋</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.tipTitle}>
              {t("driver.help.footerTitle", "Before contacting support")}
            </Text>
            <Text style={styles.tipText}>
              {t(
                "driver.help.footerTextShort",
                "Prepare your order ID, screenshot, phone number, and a short explanation."
              )}
            </Text>
          </View>
        </View>

        <View style={styles.socialSection}>
          <Text style={styles.socialTitle}>
            {t("driver.help.socialSection", "Follow MMD Delivery")}
          </Text>
          <SocialLinks
            tone="dark"
            compact
            links={instagramLinks.length ? instagramLinks : undefined}
            style={styles.socialLinks}
          />
        </View>

        <View style={styles.footer}>
          <Image
            source={MMD_LOGO}
            style={styles.footerLogo}
            resizeMode="contain"
            accessibilityLabel="MMD Delivery"
          />
          <Text style={styles.footerBrand}>MMD Delivery</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  flex: { flex: 1, minWidth: 0 },
  content: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 24,
    gap: 8,
  },
  heroCard: {
    borderRadius: 14,
    padding: 14,
    backgroundColor: MMD_ACTION_NAVY,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  heroLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 8,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  heroTitle: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    marginTop: 4,
  },
  heroSub: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    lineHeight: 14,
    marginTop: 4,
  },
  heroLogo: {
    width: 48,
    height: 48,
    borderRadius: 14,
  },
  sectionHeader: {
    marginTop: 8,
    gap: 6,
  },
  sectionTitle: {
    color: MMD_WHITE,
    fontSize: 13,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  sectionDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.13)",
  },
  helpItem: {
    minHeight: 36,
    paddingHorizontal: 4,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  disabledItem: {
    opacity: 0.62,
  },
  itemIcon: {
    fontSize: 24,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    width: 32,
    textAlign: "center",
  },
  itemTextWrap: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  itemTitle: {
    color: MMD_WHITE,
    fontSize: 13,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  itemSubtitle: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  chevron: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 18,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  rowDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  faqRow: {
    paddingVertical: 10,
    gap: 4,
  },
  faqQuestion: {
    color: MMD_WHITE,
    fontSize: 12,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  faqAnswer: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 10,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    lineHeight: 14,
  },
  tipCard: {
    marginTop: 4,
    borderRadius: 12,
    padding: 10,
    backgroundColor: MMD_ACTION_NAVY,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  tipIconBox: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  tipIcon: {
    fontSize: 18,
  },
  tipTitle: {
    color: MMD_WHITE,
    fontSize: 11,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  tipText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 9,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    lineHeight: 12,
    marginTop: 2,
  },
  socialSection: {
    marginTop: 4,
    alignItems: "center",
    gap: 6,
  },
  socialTitle: {
    color: MMD_WHITE,
    fontSize: 12,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    textAlign: "center",
  },
  socialLinks: {
    justifyContent: "center",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 40,
    marginTop: 4,
  },
  footerLogo: {
    width: 36,
    height: 36,
    borderRadius: 12,
  },
  footerBrand: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 12,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
});
