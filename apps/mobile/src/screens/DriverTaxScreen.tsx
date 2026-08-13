/**
 * Driver Tax — Figma 308:6693 Default.
 * Keeps tax PDF openers + year/month/week selection.
 */
import React, { useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  ActivityIndicator,
  Image,
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
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_MUTED,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../theme/mmdUi";

const MMD_LOGO = require("../../assets/brand/mmd-logo-ui.png");

type OverviewRow = {
  emoji: string;
  labelKey: string;
  labelFallback: string;
  valueText: string;
};

type YearOption = { value: number; label: string };
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

function BrandFooter() {
  return (
    <View style={styles.footer}>
      <Image
        source={MMD_LOGO}
        style={styles.footerLogo}
        resizeMode="contain"
        accessibilityLabel="MMD Delivery"
      />
      <Text style={styles.footerBrand}>MMD Delivery</Text>
    </View>
  );
}

export default function DriverTaxScreen() {
  const navigation = useNavigation<any>();
  const { t } = useTranslation();

  const now = new Date();

  const [downloading, setDownloading] = useState<DownloadingType>(null);
  const [selectedMonth, setSelectedMonth] = useState<number>(now.getMonth() + 1);
  const [selectedWeek, setSelectedWeek] = useState<number>(getInitialWeek());
  const [openPicker, setOpenPicker] = useState<"year" | "month" | "week" | null>(
    null,
  );

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

  const overviewRows: OverviewRow[] = useMemo(() => {
    return [
      {
        emoji: "📊",
        labelKey: "driver.tax.overview.status.label",
        labelFallback: "Status",
        valueText: `${t("driver.tax.overview.status.configured", "Configured")} · ${t(
          "driver.tax.badges.available",
          "Available",
        )}`,
      },
      {
        emoji: "📄",
        labelKey: "driver.tax.overview.formType.label",
        labelFallback: "Form Type",
        valueText: country === "US" ? "1099-NEC" : "N/A",
      },
      {
        emoji: "🌍",
        labelKey: "driver.tax.overview.country.label",
        labelFallback: "Country",
        valueText: country,
      },
      {
        emoji: "🚫",
        labelKey: "driver.tax.overview.withholding.label",
        labelFallback: "Withholding",
        valueText: t("driver.tax.overview.withholding.no", "No"),
      },
    ];
  }, [country, t]);

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

  const togglePicker = useCallback(
    (key: "year" | "month" | "week") => {
      if (isDownloading) return;
      setOpenPicker((prev) => (prev === key ? null : key));
    },
    [isDownloading],
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
        variant="mmd"
      />

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            📋 {t("driver.tax.sections.overview", "Overview")}
          </Text>

          {overviewRows.map((row, index) => (
            <View key={`${row.labelKey}-${index}`}>
              {index > 0 ? <View style={styles.divider} /> : null}
              <View style={styles.overviewRow}>
                <View style={styles.overviewLeft}>
                  <View style={styles.emojiCircle}>
                    <Text style={styles.emoji}>{row.emoji}</Text>
                  </View>
                  <View style={styles.overviewText}>
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {t(row.labelKey, row.labelFallback)}
                    </Text>
                    <Text style={styles.rowValue} numberOfLines={2}>
                      {row.valueText}
                    </Text>
                  </View>
                </View>
                <Text style={styles.chevron}>›</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={styles.warningBanner}>
          <Text style={styles.warningEmoji}>⚠️</Text>
          <View style={styles.warningTextWrap}>
            <Text style={styles.warningTitle}>
              {t("driver.tax.important.title", "We do not withhold taxes")}
            </Text>
            <Text style={styles.warningBody}>
              {t(
                "driver.tax.important.body",
                "You are responsible for declaring your earnings.",
              )}
            </Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>
          📥 {t("driver.tax.sections.documents", "Tax Documents")}
        </Text>

        <View style={styles.card}>
          <TouchableOpacity
            onPress={() => togglePicker("year")}
            disabled={isDownloading}
            activeOpacity={0.85}
            style={styles.periodRow}
          >
            <Text style={styles.periodValue}>{selectedYear}</Text>
            <Text style={styles.periodChevron}>▼</Text>
          </TouchableOpacity>
          {openPicker === "year" ? (
            <View style={styles.chipWrap}>
              {yearOptions.map((option) => {
                const active = option.value === selectedYear;
                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => {
                      onSelectYear(option.value);
                      setOpenPicker(null);
                    }}
                    disabled={isDownloading}
                    activeOpacity={0.85}
                    style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
          <View style={styles.divider} />
          <TouchableOpacity
            onPress={() => togglePicker("month")}
            disabled={isDownloading}
            activeOpacity={0.85}
            style={styles.periodRow}
          >
            <Text style={styles.periodValue}>
              {selectedMonth}/{selectedYear}
            </Text>
            <Text style={styles.periodChevron}>▼</Text>
          </TouchableOpacity>
          {openPicker === "month" ? (
            <View style={styles.chipWrap}>
              {monthOptions.map((option) => {
                const active = option.value === selectedMonth;
                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => {
                      setSelectedMonth(option.value);
                      setOpenPicker(null);
                    }}
                    disabled={isDownloading}
                    activeOpacity={0.85}
                    style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
          <View style={styles.divider} />
          <TouchableOpacity
            onPress={() => togglePicker("week")}
            disabled={isDownloading}
            activeOpacity={0.85}
            style={styles.periodRow}
          >
            <Text style={styles.periodValue}>
              W{selectedWeek}, {selectedYear}
            </Text>
            <Text style={styles.periodChevron}>▼</Text>
          </TouchableOpacity>
          {openPicker === "week" ? (
            <View style={styles.chipWrap}>
              {weekOptions.map((option) => {
                const active = option.value === selectedWeek;
                return (
                  <TouchableOpacity
                    key={option.value}
                    onPress={() => {
                      setSelectedWeek(option.value);
                      setOpenPicker(null);
                    }}
                    disabled={isDownloading}
                    activeOpacity={0.85}
                    style={[
                      styles.chipTiny,
                      active ? styles.chipActive : styles.chipInactive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.chipTextTiny,
                        active && styles.chipTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          onPress={onLearnMore}
          style={styles.learnMoreBtn}
          activeOpacity={0.85}
        >
          <Text style={styles.learnMoreText}>
            {t("driver.tax.buttons.learnMore", "Learn more")}
          </Text>
        </TouchableOpacity>

        <View style={styles.card}>
          {canSeeTaxDocuments ? (
            <>
              <DownloadRow
                loading={downloading === "weekly"}
                disabled={isDownloading}
                label={
                  downloading === "weekly"
                    ? t("common.loading", "Loading…")
                    : `${t("driver.tax.buttons.weeklySummary", "Weekly summary (PDF)")} — W${selectedWeek}, ${selectedYear}`
                }
                onPress={onWeeklySummary}
              />
              <View style={styles.divider} />
              <DownloadRow
                loading={downloading === "monthly"}
                disabled={isDownloading}
                label={
                  downloading === "monthly"
                    ? t("common.loading", "Loading…")
                    : `${t("driver.tax.buttons.monthlySummary", "Monthly summary (PDF)")} — ${selectedMonth}/${selectedYear}`
                }
                onPress={onMonthlySummary}
              />
              <View style={styles.divider} />
              <DownloadRow
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
            <DownloadRow
              loading={false}
              disabled={false}
              label={t("driver.tax.buttons.yearlySummary", "Yearly summary (PDF)")}
              onPress={onUnavailable}
            />
          )}
          <View style={styles.divider} />
          <DownloadRow
            loading={false}
            disabled={false}
            label={t("driver.tax.buttons.w9", "W-9 (Form + PDF)")}
            onPress={onW9}
          />
        </View>

        <Text style={styles.metaNote}>
          {t(
            "driver.tax.yearlySummary.note",
            "Note: Downloads may update download_count and last_downloaded_at.",
          )}
        </Text>

        <BrandFooter />
      </ScrollView>
    </SafeAreaView>
  );
}

function DownloadRow({
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
      style={[styles.downloadRow, disabled && styles.downloadRowDisabled]}
      activeOpacity={0.85}
      disabled={disabled}
    >
      <View style={styles.downloadLeft}>
        <Text style={styles.downloadEmoji}>📄</Text>
        <Text style={styles.downloadLabel} numberOfLines={2}>
          {label}
        </Text>
      </View>
      {loading ? (
        <ActivityIndicator size="small" color={MMD_WHITE} />
      ) : (
        <Text style={styles.downloadArrow}>⬇️</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  content: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    gap: 16,
  },
  card: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 14,
    padding: 16,
    gap: 0,
  },
  cardTitle: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    marginBottom: 12,
  },
  overviewRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  overviewLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
    paddingRight: 8,
  },
  emojiCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  emoji: {
    fontSize: 18,
  },
  overviewText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  rowValue: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  chevron: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  divider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  warningBanner: {
    backgroundColor: "rgba(245,158,11,0.1)",
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.2)",
    borderRadius: 12,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  warningEmoji: {
    fontSize: 18,
    color: "#F59E0B",
  },
  warningTextWrap: {
    flex: 1,
    gap: 2,
  },
  warningTitle: {
    color: "#F59E0B",
    fontSize: 14,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  warningBody: {
    color: MMD_WHITE,
    fontSize: 13,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  sectionTitle: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  periodRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
  },
  periodValue: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  periodChevron: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    paddingBottom: 10,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipTiny: {
    minWidth: 34,
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: "rgba(255,255,255,0.16)",
    borderColor: "rgba(255,255,255,0.22)",
  },
  chipInactive: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.1)",
  },
  chipText: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 13,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  chipTextTiny: {
    color: "rgba(255,255,255,0.78)",
    fontSize: 11,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  chipTextActive: { color: MMD_WHITE },
  learnMoreBtn: {
    backgroundColor: MMD_TAXI_GREEN,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  learnMoreText: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  downloadRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    gap: 10,
  },
  downloadRowDisabled: { opacity: 0.7 },
  downloadLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flex: 1,
    paddingRight: 8,
  },
  downloadEmoji: { fontSize: 18 },
  downloadLabel: {
    flex: 1,
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  downloadArrow: { fontSize: 18 },
  metaNote: {
    color: MMD_MUTED,
    fontSize: 12,
    fontFamily: MMD_FONT.regular,
    fontWeight: "400",
    lineHeight: 16,
  },
  footer: {
    alignItems: "center",
    gap: 12,
    paddingTop: 8,
  },
  footerLogo: {
    width: 44,
    height: 44,
    borderRadius: 10,
  },
  footerBrand: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 12,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
});
