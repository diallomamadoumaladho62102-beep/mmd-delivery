import React, { useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import {
  openMonthlyTaxPdf,
  openWeeklyTaxPdf,
  openYearlyTaxPdf,
} from "../lib/taxPdf";

type Row = {
  labelKey: string;
  valueText: string;
  badge?: { textKey: string; kind: "ok" | "warn" | "info" };
};

type YearOption = {
  value: number;
  label: string;
};

type DownloadingType = "weekly" | "monthly" | "yearly" | null;

function currentYearLocal() {
  return new Date().getFullYear();
}

function getInitialWeek(): number {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  const oneWeek = 1000 * 60 * 60 * 24 * 7;

  return Math.min(Math.max(Math.floor(diff / oneWeek) + 1, 1), 53);
}

export default function DriverTaxScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const now = new Date();

  const [downloading, setDownloading] = useState<DownloadingType>(null);
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1);
  const [selectedWeek, setSelectedWeek] = useState<number>(getInitialWeek());

  const country = "US";
  const isVerified = true;
  const canSeeTaxDocuments = country === "US" && isVerified;

  const yearOptions: YearOption[] = useMemo(() => {
    const y = currentYearLocal();
    return [y, y - 1, y - 2, y - 3].map((n) => ({
      value: n,
      label: String(n),
    }));
  }, []);

  const monthOptions = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => ({
        value: index + 1,
        label: String(index + 1),
      })),
    [],
  );

  const weekOptions = useMemo(
    () =>
      Array.from({ length: 53 }, (_, index) => ({
        value: index + 1,
        label: String(index + 1),
      })),
    [],
  );

  const [selectedYear, setSelectedYear] = useState<number>(
    yearOptions[1]?.value ?? currentYearLocal() - 1,
  );

  const rows: Row[] = useMemo(() => {
    return [
      {
        labelKey: "driver.tax.overview.status.label",
        valueText: "Configured",
        badge: { textKey: "driver.tax.badges.available", kind: "ok" },
      },
      {
        labelKey: "driver.tax.overview.formType.label",
        valueText: country === "US" ? "1099-NEC" : "N/A",
      },
      { labelKey: "driver.tax.overview.country.label", valueText: country },
      { labelKey: "driver.tax.overview.withholding.label", valueText: "No" },
    ];
  }, [country]);

  const isDownloading = downloading !== null;

  const onW9 = useCallback(() => {
    navigation.navigate("DriverW9");
  }, [navigation]);

  const onLearnMore = useCallback(() => {
    Alert.alert(
      t("driver.tax.learnMore.title", "How taxes work"),
      t(
        "driver.tax.learnMore.body",
        "We don’t withhold taxes. You are responsible for reporting your earnings.",
      ),
    );
  }, [t]);

  const onSelectYear = useCallback(
    (year: number) => {
      const current = currentYearLocal();

      if (year > current) {
        Alert.alert(
          t("driver.tax.year.future.title", "Not finished yet"),
          t(
            "driver.tax.year.future.body",
            "This year is not completed yet. We’ll switch to the previous year.",
          ),
        );

        setSelectedYear(current - 1);
        return;
      }

      setSelectedYear(year);
    },
    [t],
  );

  const onUnavailable = useCallback(() => {
    Alert.alert(
      t("common.unavailable", "Unavailable"),
      country !== "US"
        ? t(
            "driver.tax.countryNotSupported",
            "This document is only available in the US for now.",
          )
        : t("driver.tax.verifyFirst", "Please verify your account first."),
    );
  }, [country, t]);

  const onYearlySummary = useCallback(async () => {
    if (isDownloading) return;

    try {
      setDownloading("yearly");
      await openYearlyTaxPdf(selectedYear);
    } catch (error: any) {
      console.log("DriverTaxScreen.onYearlySummary error:", error?.message, error);
    } finally {
      setDownloading(null);
    }
  }, [isDownloading, selectedYear]);

  const onMonthlySummary = useCallback(async () => {
    if (isDownloading) return;

    try {
      setDownloading("monthly");
      await openMonthlyTaxPdf(selectedYear, selectedMonth);
    } catch (error: any) {
      console.log("DriverTaxScreen.onMonthlySummary error:", error?.message, error);
    } finally {
      setDownloading(null);
    }
  }, [isDownloading, selectedMonth, selectedYear]);

  const onWeeklySummary = useCallback(async () => {
    if (isDownloading) return;

    try {
      setDownloading("weekly");
      await openWeeklyTaxPdf(selectedYear, selectedWeek);
    } catch (error: any) {
      console.log("DriverTaxScreen.onWeeklySummary error:", error?.message, error);
    } finally {
      setDownloading(null);
    }
  }, [isDownloading, selectedWeek, selectedYear]);

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("driver.tax.title", "Tax information")}
        fallbackRoute="DriverTabs"
        variant="dark"
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {t("driver.tax.sections.overview", "Overview")}
          </Text>

          {rows.map((row, index) => (
            <View
              key={`${row.labelKey}-${index}`}
              style={[styles.row, index === rows.length - 1 && styles.rowLast]}
            >
              <Text style={styles.rowLabel} numberOfLines={1}>
                {t(row.labelKey, row.labelKey)}
              </Text>

              <View style={styles.rowRight}>
                {row.badge ? (
                  <View style={[styles.badge, badgeStyle(row.badge.kind)]}>
                    <Text style={styles.badgeText} numberOfLines={1}>
                      {t(row.badge.textKey, row.badge.kind === "ok" ? "Available" : "Soon")}
                    </Text>
                  </View>
                ) : null}

                <Text style={styles.rowValue} numberOfLines={2}>
                  {row.valueText}
                </Text>
              </View>
            </View>
          ))}
        </View>

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
                "You are responsible for declaring your earnings.",
              )}
            </Text>
          </View>

          <View style={styles.yearBox}>
            <Text style={styles.yearLabel}>
              {t("driver.tax.year.label", "Year")}
            </Text>

            <View style={styles.yearChips}>
              {yearOptions.map((option) => {
                const active = option.value === selectedYear;

                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => onSelectYear(option.value)}
                    disabled={isDownloading}
                    activeOpacity={0.85}
                    style={[
                      styles.yearChip,
                      active ? styles.yearChipActive : styles.yearChipInactive,
                      isDownloading && { opacity: 0.85 },
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
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <Text style={styles.yearHint}>
              {t("driver.tax.year.hint", "Select the year you want to download.")}
            </Text>
          </View>

          <View style={styles.yearBox}>
            <Text style={styles.yearLabel}>
              {t("driver.tax.month.label", "Month")}
            </Text>

            <View style={styles.yearChips}>
              {monthOptions.map((option) => {
                const active = option.value === selectedMonth;

                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => setSelectedMonth(option.value)}
                    disabled={isDownloading}
                    activeOpacity={0.85}
                    style={[
                      styles.smallChip,
                      active ? styles.yearChipActive : styles.yearChipInactive,
                      isDownloading && { opacity: 0.85 },
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
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.yearBox}>
            <Text style={styles.yearLabel}>
              {t("driver.tax.week.label", "Week")}
            </Text>

            <View style={styles.yearChips}>
              {weekOptions.map((option) => {
                const active = option.value === selectedWeek;

                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => setSelectedWeek(option.value)}
                    disabled={isDownloading}
                    activeOpacity={0.85}
                    style={[
                      styles.tinyChip,
                      active ? styles.yearChipActive : styles.yearChipInactive,
                      isDownloading && { opacity: 0.85 },
                    ]}
                  >
                    <Text
                      style={[
                        styles.tinyChipText,
                        active
                          ? styles.yearChipTextActive
                          : styles.yearChipTextInactive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
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

            {canSeeTaxDocuments ? (
              <>
                <TaxButton
                  loading={downloading === "weekly"}
                  disabled={isDownloading}
                  label={
                    downloading === "weekly"
                      ? t("common.loading", "Loading…")
                      : `${t("driver.tax.buttons.weeklySummary", "Weekly summary (PDF)")} — W${selectedWeek}, ${selectedYear}`
                  }
                  onPress={onWeeklySummary}
                />

                <TaxButton
                  loading={downloading === "monthly"}
                  disabled={isDownloading}
                  label={
                    downloading === "monthly"
                      ? t("common.loading", "Loading…")
                      : `${t("driver.tax.buttons.monthlySummary", "Monthly summary (PDF)")} — ${selectedMonth}/${selectedYear}`
                  }
                  onPress={onMonthlySummary}
                />

                <TaxButton
                  loading={downloading === "yearly"}
                  disabled={isDownloading}
                  label={
                    downloading === "yearly"
                      ? t("common.loading", "Loading…")
                      : `${t(
                          "driver.tax.buttons.yearlySummary",
                          "Yearly summary (PDF)",
                        )} — ${selectedYear}`
                  }
                  onPress={onYearlySummary}
                />
              </>
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

            <TouchableOpacity
              onPress={onW9}
              style={[styles.secondaryBtn, { marginTop: 10 }]}
              activeOpacity={0.85}
            >
              <Text style={styles.secondaryBtnText}>W-9 (Form + PDF)</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.metaNote}>
            <Text style={styles.metaNoteText}>
              {t(
                "driver.tax.yearlySummary.note",
                "Note: Downloads may update download_count and last_downloaded_at.",
              )}
            </Text>
          </View>
        </View>

        <View style={styles.footerSpace} />
      </ScrollView>
    </SafeAreaView>
  );
}

function TaxButton({
  label,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.secondaryBtn, { marginTop: 10 }, disabled && styles.secondaryBtnDisabled]}
      activeOpacity={0.85}
      disabled={disabled}
    >
      <View style={styles.btnRow}>
        {loading ? (
          <ActivityIndicator size="small" color="rgba(255,255,255,0.85)" />
        ) : null}

        <Text style={styles.secondaryBtnText}>{label}</Text>
      </View>
    </TouchableOpacity>
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

  rowLast: { borderBottomWidth: 0 },

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

  smallChip: {
    minWidth: 42,
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },

  tinyChip: {
    minWidth: 34,
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 7,
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

  tinyChipText: {
    fontSize: 11,
    fontWeight: "900",
  },

  yearChipTextActive: { color: "rgba(255,255,255,0.95)" },

  yearChipTextInactive: { color: "rgba(255,255,255,0.78)" },

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

  secondaryBtnDisabled: { opacity: 0.7 },

  secondaryBtnText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
  },

  btnRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 12,
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