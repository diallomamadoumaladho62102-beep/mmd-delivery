// apps/mobile/src/components/DriverAccountCard.tsx
import React from "react";
import { I18nManager, View, Text, TouchableOpacity } from "react-native";
import { useTranslation } from "react-i18next";

function ProgressPill({ value }: { value: number }) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <View
      style={{
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: "rgba(59,130,246,0.18)",
        borderWidth: 1,
        borderColor: "rgba(59,130,246,0.35)",
      }}
    >
      <Text style={{ color: "white", fontWeight: "900", fontSize: 12 }}>
        {v}%
      </Text>
    </View>
  );
}

function StatusLine({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value?: string;
}) {
  const isRTL = I18nManager.isRTL;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        marginTop: 8,
      }}
    >
      <Text style={{ width: 22, color: "rgba(255,255,255,0.9)" }}>{icon}</Text>

      <Text style={{ flex: 1, color: "#E5E7EB", fontWeight: "900" }}>{label}</Text>

      {value ? (
        <Text
          style={{
            color: "#9CA3AF",
            fontWeight: "800",
            textAlign: isRTL ? "left" : "right",
            maxWidth: 180, // ✅ stable RN (évite "%")
          }}
          numberOfLines={1}
        >
          {value}
        </Text>
      ) : null}
    </View>
  );
}

export function DriverAccountCard({
  progress,
  vehicleOk,
  docsDone,
  docsTotal,
  payoutOk,
  onPress,
  onAction,
}: {
  progress: number;
  vehicleOk: boolean;
  docsDone: number;
  docsTotal: number;
  payoutOk: boolean;
  onPress: () => void;
  onAction: () => void;
}) {
  const { t } = useTranslation();

  // ✅ Docs: si docsTotal = 0 => Non requis (ex: vélo)
  const docsNotRequired = docsTotal <= 0;

  // ✅ OK si non requis, sinon si done >= total
  const docsOk = docsNotRequired ? true : docsDone >= docsTotal;

  const docsValue = docsNotRequired
    ? t("common.notRequired", "Not required")
    : `${docsDone}/${docsTotal}`;

  const docsIcon = docsOk ? "✅" : "⏳";

  // ✅ RTL support
  const isRTL = I18nManager.isRTL;
  const chevron = isRTL ? "‹" : "›";

  return (
    <View
      style={{
        backgroundColor: "#0B1220",
        borderColor: "#111827",
        borderWidth: 1,
        borderRadius: 18,
        padding: 14,
        marginBottom: 14,
      }}
    >
      <TouchableOpacity activeOpacity={0.85} onPress={onPress}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1, paddingEnd: 10 }}>
            <Text style={{ color: "white", fontSize: 18, fontWeight: "900" }}>
              {t("driver.account.title", "Driver account")}
            </Text>

            <Text
              style={{
                color: "#9CA3AF",
                fontWeight: "800",
                marginTop: 6,
                lineHeight: 18,
              }}
            >
              {t("driver.account.subtitle", "Vehicle, documents, payout, guided status.")}
            </Text>
          </View>

          <ProgressPill value={progress} />

          <Text
            style={{
              marginStart: 10,
              color: "#93C5FD",
              fontWeight: "900",
              fontSize: 22,
            }}
          >
            {chevron}
          </Text>
        </View>

        <View style={{ height: 10 }} />

        <StatusLine
          icon={vehicleOk ? "✅" : "❌"}
          label={t("driver.account.vehicle", "Vehicle")}
          value={vehicleOk ? t("common.ok", "OK") : t("common.toAdd", "To add")}
        />

        <StatusLine
          icon={docsIcon}
          label={t("driver.account.documents", "Documents")}
          value={docsValue}
        />

        <StatusLine
          icon={payoutOk ? "✅" : "❌"}
          label={t("driver.account.payout", "Payout")}
          value={
            payoutOk
              ? t("common.ready", "Ready")
              : t("common.notConfigured", "Not configured")
          }
        />
      </TouchableOpacity>

      <TouchableOpacity
        activeOpacity={0.9}
        onPress={onAction}
        style={{
          marginTop: 14,
          backgroundColor: "rgba(59,130,246,0.22)",
          borderWidth: 1,
          borderColor: "rgba(59,130,246,0.40)",
          paddingVertical: 12,
          borderRadius: 14,
          alignItems: "center",
        }}
      >
        <Text style={{ color: "white", fontWeight: "900" }}>
          {t("driver.account.finalizeNow", "Finish now")}
        </Text>
      </TouchableOpacity>
    </View>
  );
}
