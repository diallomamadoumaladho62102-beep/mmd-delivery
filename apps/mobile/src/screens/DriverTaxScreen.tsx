import React, { useMemo, useState, useCallback } from "react";
import {
  SafeAreaView,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";

// ✅ SignedUrl + WebBrowser (apps/mobile/lib/taxPdf.ts)
// Écran: apps/mobile/src/screens/DriverTaxScreen.tsx
// => ../../lib/taxPdf
import { openYearlyTaxPdf } from "../../lib/taxPdf";

type Row = {
  labelKey: string;
  valueText: string;
  badge?: { textKey: string; kind: "ok" | "warn" | "info" };
};

type YearOption = {
  value: number;
  label: string;
};

function currentYearLocal() {
  return new Date().getFullYear();
}

export default function DriverTaxScreen() {
  const navigation = useNavigation<any>();

  const onW9 = useCallback(() => {
    navigation.navigate("DriverW9");
  }, [navigation]);
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(false);

  // TODO: Remplacer par de vraies valeurs (profile / tax_profile)
  const country = "US";
  const isVerified = true;

  const canSeeYearlySummary = country === "US" && isVerified;

  // ✅ Years dropdown (ex: current, -1, -2, -3)
  const yearOptions: YearOption[] = useMemo(() => {
    const y = currentYearLocal();
    const list = [y, y - 1, y - 2, y - 3].map((n) => ({
      value: n,
      label: String(n),
    }));
    return list;
  }, []);

  // ✅ Default: previous year
  const [selectedYear, setSelectedYear] = useState<number>(
    yearOptions[1]?.value ?? currentYearLocal() - 1
  );

  const rows: Row[] = useMemo(() => {
    const status = "Not configured";
    const formType = country === "US" ? "1099-NEC" : "N/A";
    const withholding = "No";

    return [
      {
        labelKey: "driver.tax.overview.status.label",
        valueText: status,
        badge: { textKey: "driver.tax.badges.soon", kind: "info" },
      },
      { labelKey: "driver.tax.overview.formType.label", valueText: formType },
      { labelKey: "driver.tax.overview.country.label", valueText: country },
      {
        labelKey: "driver.tax.overview.withholding.label",
        valueText: withholding,
      },
    ];
  }, [country]);

  const onLearnMore = useCallback(() => {
    Alert.alert(
      t("driver.tax.learnMore.title", "How taxes work"),
      t(
        "driver.tax.learnMore.body",
        "We don’t withhold taxes. You are responsible for reporting your earnings."
      )
    );
  }, [t]);

  // ✅ If user selects a future year, warn + force previous year
  const onSelectYear = useCallback(
    (year: number) => {
      const current = currentYearLocal();
      const previous = current - 1;

      if (year > current) {
        Alert.alert(
          t("driver.tax.year.future.title", "Not finished yet"),
          t(
            "driver.tax.year.future.body",
            "This year is not completed yet. We’ll switch to the previous year."
          )
        );
        setSelectedYear(previous);
        return;
      }

      setSelectedYear(year);
    },
    [t]
  );

  const onYearlySummary = useCallback(async () => {
    if (downloading) return;

    try {
      setDownloading(true);

      // ✅ Use selected year
      const year = selectedYear;

      await openYearlyTaxPdf(year);
    } catch (e: any) {
      console.log("DriverTaxScreen.onYearlySummary error:", e?.message, e);
      Alert.alert(
        t("common.error", "Error"),
        t(
          "driver.tax.yearlySummary.error",
          "Unable to download the PDF right now."
        )
      );
    } finally {
      setDownloading(false);
    }
  }, [downloading, selectedYear, t]);

  const onUnavailable = useCallback(() => {
    Alert.alert(
      t("common.unavailable", "Unavailable"),
      country !== "US"
        ? t(
            "driver.tax.countryNotSupported",
            "This document is only available in the US for now."
          )
        : t("driver.tax.verifyFirst", "Please verify your account first.")
    );
}, [navigation]);
  return (
    <SafeAreaView style={styles.safe}>
      {/* HEADER */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.8}
        >
          <Text style={styles.backText}>{t("common.back", "‹ Back")}</Text>
        </TouchableOpacity>

        <Text style={styles.title}>
          {t("driver.tax.title", "Tax information")}
        </Text>

        <View style={{ width: 68 }} />
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* OVERVIEW */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {t("driver.tax.sections.overview", "Overview")}
          </Text>

          {rows.map((r, idx) => (
            <View
              key={`${r.labelKey}-${idx}`}
              style={[styles.row, idx === rows.length - 1 && styles.rowLast]}
            >
              <Text
                style={styles.rowLabel}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {t(r.labelKey, r.labelKey)}
              </Text>

              <View style={styles.rowRight}>
                {r.badge && (
                  <View style={[styles.badge, badgeStyle(r.badge.kind)]}>
                    <Text style={styles.badgeText} numberOfLines={1}>
                      {t(r.badge.textKey, "Soon")}
                    </Text>
                  </View>
                )}

                <Text
                  style={styles.rowValue}
                  numberOfLines={2}
                  ellipsizeMode="tail"
                >
                  {r.valueText}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {/* IMPORTANT */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {t("driver.tax.sections.important", "Important")}
          </Text>

          <View style={styles.noteBox}>
            <Text style={styles.noteTitle}>
              {t("driver.tax.important.title", "We do not withhold taxes")}
            </Text>
            <Text style={styles.noteText}>
              {t(
                "driver.tax.important.body",
                "You are responsible for declaring your earnings."
              )}
            </Text>
          </View>

          {/* ✅ Year selector */}
          <View style={styles.yearBox}>
            <Text style={styles.yearLabel}>
              {t("driver.tax.year.label", "Year")}
            </Text>

            <View style={styles.yearChips}>
              {yearOptions.map((opt) => {
                const active = opt.value === selectedYear;
                return (
                  <TouchableOpacity
                    key={opt.value}
                    onPress={() => onSelectYear(opt.value)}
                    disabled={downloading}
                    activeOpacity={0.85}
                    style={[
                      styles.yearChip,
                      active ? styles.yearChipActive : styles.yearChipInactive,
                      downloading && { opacity: 0.85 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.yearChipText,
                        active
                          ? styles.yearChipTextActive
                          : styles.yearChipTextInactive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.yearHint}>
              {t(
                "driver.tax.year.hint",
                "Select the year you want to download."
              )}
            </Text>
          </View>

          <View style={styles.actions}>
            <TouchableOpacity
              onPress={onLearnMore}
              style={styles.primaryBtn}
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>
                {t("driver.tax.buttons.learnMore", "Learn more")}
              </Text>
            </TouchableOpacity>

            {canSeeYearlySummary ? (
              <TouchableOpacity
                onPress={onYearlySummary}
                style={[
                  styles.secondaryBtn,
                  downloading && styles.secondaryBtnDisabled,
                ]}
                activeOpacity={0.85}
                disabled={downloading}
              >
                <View style={styles.btnRow}>
                  {downloading && (
                    <ActivityIndicator
                      size="small"
                      color="rgba(255,255,255,0.85)"
                    />
                  )}
                  <Text style={styles.secondaryBtnText}>
                    {downloading
                      ? t("common.loading", "Loading…")
                      : t(
                          "driver.tax.buttons.yearlySummary",
                          "Yearly summary (PDF)"
                        )}
                    {!downloading ? ` — ${selectedYear}` : ""}
                  </Text>
                </View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={onUnavailable}
                style={styles.secondaryBtn}
                activeOpacity={0.85}
              >
                <Text style={styles.secondaryBtnText}>
                  {t("driver.tax.buttons.yearlySummary", "Yearly summary (PDF)")}
                </Text>
              </TouchableOpacity>
            )}
          </View>


          <TouchableOpacity
            onPress={onW9}
            style={[styles.secondaryBtn, { marginTop: 10 }]} 
            activeOpacity={0.85}
          >
            <Text style={styles.secondaryBtnText}>W-9 (Form + PDF)</Text>
          </TouchableOpacity>
          <View style={styles.metaNote}>
            <Text style={styles.metaNoteText}>
              {t(
                "driver.tax.yearlySummary.note",
                "Note: Download increments download_count and updates last_downloaded_at."
              )}
            </Text>
          </View>
        </View>

        <View style={styles.footerSpace} />
      </ScrollView>
    </SafeAreaView>
  );
}

function badgeStyle(kind: "ok" | "warn" | "info") {
  switch (kind) {
    case "ok":
      return {
        backgroundColor: "rgba(46,204,113,0.18)",
        borderColor: "rgba(46,204,113,0.35)",
      };
    case "warn":
      return {
        backgroundColor: "rgba(241,196,15,0.18)",
        borderColor: "rgba(241,196,15,0.35)",
      };
    default:
      return {
        backgroundColor: "rgba(52,152,219,0.18)",
        borderColor: "rgba(52,152,219,0.35)",
      };
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#050A14" },

  header: {
    paddingTop: Platform.OS === "android" ? 12 : 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  backBtn: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  backText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 14,
    fontWeight: "700",
  },

  title: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 16,
    fontWeight: "800",
  },

  content: { padding: 16, paddingTop: 6 },

  card: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 18,
    padding: 14,
    marginBottom: 14,
  },

  cardTitle: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 10,
  },

  row: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
    flexDirection: "row",
    alignItems: "center",
  },

  rowLast: {
    borderBottomWidth: 0,
  },

  rowLabel: {
    flex: 1,
    flexShrink: 1,
    paddingRight: 10,
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    fontWeight: "700",
  },

  rowRight: {
    flexShrink: 1,
    maxWidth: "58%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
  },

  rowValue: {
    flexShrink: 1,
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontWeight: "800",
    textAlign: "right",
  },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    marginRight: 8,
  },

  badgeText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    fontWeight: "900",
  },

  noteBox: {
    backgroundColor: "rgba(0,0,0,0.22)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 16,
    padding: 12,
  },

  noteTitle: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 6,
  },

  noteText: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },

  // ✅ Year selector styles
  yearBox: {
    marginTop: 12,
    backgroundColor: "rgba(0,0,0,0.18)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 16,
    padding: 12,
  },

  yearLabel: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 10,
  },

  yearChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },

  yearChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },

  yearChipActive: {
    backgroundColor: "rgba(255,255,255,0.16)",
    borderColor: "rgba(255,255,255,0.22)",
  },

  yearChipInactive: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.10)",
  },

  yearChipText: {
    fontSize: 13,
    fontWeight: "900",
  },

  yearChipTextActive: {
    color: "rgba(255,255,255,0.95)",
  },

  yearChipTextInactive: {
    color: "rgba(255,255,255,0.78)",
  },

  yearHint: {
    marginTop: 10,
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    fontWeight: "600",
  },

  actions: { marginTop: 12 },

  primaryBtn: {
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
    marginBottom: 10,
  },

  primaryBtnText: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 14,
    fontWeight: "900",
  },

  secondaryBtn: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
  },

  secondaryBtnDisabled: {
    opacity: 0.7,
  },

  secondaryBtnText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    fontWeight: "800",
  },

  btnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },

  metaNote: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
  },

  metaNoteText: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },

  footerSpace: { height: 24 },
});




