/**
 * Profile & Setup card — Figma Driver Account 294:6021.
 */
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../theme/mmdUi";

const RED = "#EF4444";
const MUTED = "#E5E7EB";

function ProgressRing({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <View style={styles.ringWrap}>
      <View style={styles.ringTrack} />
      <View
        style={[
          styles.ringProgress,
          {
            borderColor: v >= 100 ? MMD_TAXI_GREEN : "#60A5FA",
            // Approximate fill via opacity when incomplete
            opacity: v <= 0 ? 0.35 : 1,
          },
        ]}
      />
      <Text style={styles.ringText}>{v}%</Text>
    </View>
  );
}

function SetupRow({
  icon,
  iconBg,
  label,
  hint,
  status,
  statusColor,
}: {
  icon: string;
  iconBg: string;
  label: string;
  hint: string;
  status: string;
  statusColor: string;
}) {
  return (
    <View style={styles.setupRow}>
      <View style={[styles.setupIcon, { backgroundColor: iconBg }]}>
        <Text style={styles.setupEmoji}>{icon}</Text>
      </View>
      <View style={styles.setupText}>
        <Text style={styles.setupLabel}>{label}</Text>
        <Text style={styles.setupHint}>{hint}</Text>
      </View>
      <Text style={[styles.setupStatus, { color: statusColor }]}>{status}</Text>
    </View>
  );
}

export function DriverAccountCard({
  progress,
  vehicleOk,
  docsDone,
  docsTotal,
  payoutOk,
  guidedActive,
  onPress,
  onAction,
}: {
  progress: number;
  vehicleOk: boolean;
  docsDone: number;
  docsTotal: number;
  payoutOk: boolean;
  guidedActive?: boolean;
  onPress: () => void;
  onAction: () => void;
}) {
  const { t } = useTranslation();
  const docsNotRequired = docsTotal <= 0;
  const docsOk = docsNotRequired ? true : docsDone >= docsTotal;
  const docsValue = docsNotRequired
    ? t("common.notRequired", "Not required")
    : `${docsDone}/${docsTotal}`;
  const active = guidedActive ?? progress >= 100;

  return (
    <View style={styles.card}>
      <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title}>
              {t("driver.account.setupTitle", "Profile & Setup")}
            </Text>
            <Text style={styles.subtitle}>
              {t(
                "driver.account.setupSubtitle",
                "Complete your account to start driving",
              )}
            </Text>
          </View>
          <ProgressRing value={progress} />
        </View>

        <View style={styles.list}>
          <SetupRow
            icon="🚗"
            iconBg="#FEE2E2"
            label={t("driver.account.vehicle", "Vehicle")}
            hint={t("driver.account.vehicleHint", "Add your vehicle details")}
            status={
              vehicleOk
                ? t("common.ok", "OK")
                : t("common.toAdd", "Not added")
            }
            statusColor={vehicleOk ? MMD_WHITE : RED}
          />
          <SetupRow
            icon="📋"
            iconBg="#FEF3C7"
            label={t("driver.account.documents", "Documents")}
            hint={t(
              "driver.account.documentsHint",
              "Upload required documents",
            )}
            status={docsValue}
            statusColor={docsOk ? MMD_TAXI_GREEN : MMD_WHITE}
          />
          <SetupRow
            icon="💳"
            iconBg="#FEE2E2"
            label={t("driver.account.payout", "Payout")}
            hint={t(
              "driver.account.payoutHint",
              "Set up your payout method",
            )}
            status={
              payoutOk
                ? t("common.ready", "Ready")
                : t("common.notConfigured", "Not configured")
            }
            statusColor={payoutOk ? MMD_TAXI_GREEN : RED}
          />
          <SetupRow
            icon="✅"
            iconBg="#D1FAE5"
            label={t("driver.account.guidedStatus", "Guided Status")}
            hint={
              active
                ? t("driver.account.guidedActive", "Your account is active")
                : t(
                    "driver.account.guidedIncomplete",
                    "Finish setup to go active",
                  )
            }
            status={
              active
                ? t("driver.account.statusActive", "Active")
                : t("driver.account.statusIncomplete", "Incomplete")
            }
            statusColor={active ? MMD_TAXI_GREEN : RED}
          />
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onAction}
        style={styles.cta}
      >
        <Text style={styles.ctaText}>
          {t("driver.account.finalizeNow", "Finish Setup")}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 16,
    padding: 16,
    gap: 16,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerText: { flex: 1, paddingRight: 12, gap: 4 },
  title: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 16,
  },
  subtitle: {
    color: MUTED,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 13,
  },
  ringWrap: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
  },
  ringTrack: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.15)",
  },
  ringProgress: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 28,
    borderWidth: 4,
  },
  ringText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
  list: { gap: 12 },
  setupRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  setupIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  setupEmoji: { fontSize: 16 },
  setupText: { flex: 1, minWidth: 0, gap: 2 },
  setupLabel: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 14,
  },
  setupHint: {
    color: MUTED,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 12,
  },
  setupStatus: {
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
  },
  cta: {
    backgroundColor: MMD_WHITE,
    borderRadius: 16,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    color: MMD_BLUE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 15,
  },
});
