import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";

import { TinType, W9GetResponse, W9Payload, openW9Pdf, w9Get, w9Submit } from "../../lib/taxW9";
import { rowDirection, textAlignStart, mirrorChevron } from "../i18n/rtl";
import { formatDateTime } from "../i18n/formatters";

function onlyDigits(s: string) {
  return String(s || "").replace(/\D+/g, "");
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

function Row({ label, ok, hint }: { label: string; ok: boolean; hint?: string }) {
  return (
    <View style={[styles.checkRow, { flexDirection: rowDirection() }]}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={[styles.checkLabel, { textAlign: textAlignStart() }]}>{label}</Text>
        {hint ? (
          <Text style={[styles.checkHint, { textAlign: textAlignStart() }]}>{hint}</Text>
        ) : null}
      </View>
      <Text style={styles.checkIcon}>{ok ? "✅" : "❌"}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  secureTextEntry,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: any;
  secureTextEntry?: boolean;
}) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text style={[styles.fieldLabel, { textAlign: textAlignStart() }]}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="rgba(255,255,255,0.35)"
        keyboardType={keyboardType}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secureTextEntry}
        style={[styles.input, { textAlign: textAlignStart() }]}
      />
    </View>
  );
}

export default function DriverW9Screen() {
  const navigation = useNavigation<any>();
  const { t, i18n } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [status, setStatus] = useState<"missing" | "signed">("missing");
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [maskedTin, setMaskedTin] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  const [legalName, setLegalName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [entityType, setEntityType] = useState("Individual/sole proprietor");
  const [address1, setAddress1] = useState("");
  const [address2, setAddress2] = useState("");
  const [city, setCity] = useState("");
  const [stateCode, setStateCode] = useState("NJ");
  const [zip, setZip] = useState("");

  const [tinType, setTinType] = useState<TinType>("SSN");
  const [tin, setTin] = useState("");
  const [signedName, setSignedName] = useState("");

  const alertTitle = t("driver.w9.title", "W-9");
  const dash = t("common.dash", "—");

  const tinDigits = useMemo(() => onlyDigits(tin), [tin]);
  const hasTinInput = tinDigits.length > 0;

  const tinOk = useMemo(() => {
    if (status === "missing") return tinDigits.length === 9;
    return !hasTinInput || tinDigits.length === 9;
  }, [status, tinDigits.length, hasTinInput]);

  const required = useMemo(() => {
    const legalOk = !!legalName.trim();
    const entityOk = !!entityType.trim();
    const addrOk = !!address1.trim();
    const cityOk = !!city.trim();
    const stateOk = !!stateCode.trim();
    const zipOk = !!zip.trim();
    const signOk = !!signedName.trim();
    const all = legalOk && entityOk && addrOk && cityOk && stateOk && zipOk && tinOk && signOk;
    return { legalOk, entityOk, addrOk, cityOk, stateOk, zipOk, tinOk, signOk, all };
  }, [legalName, entityType, address1, city, stateCode, zip, tinOk, signedName]);

  const submitLabel =
    status === "signed"
      ? t("driver.w9.updateResign", "Update / Re-sign")
      : t("driver.w9.submit", "Submit W-9");

  const load = useCallback(async (mode: "init" | "refresh" = "init") => {
    if (mode === "refresh") setRefreshing(true);
    else setLoading(true);

    try {
      const data: W9GetResponse = await w9Get();

      if (data.status === "missing") {
        setStatus("missing");
        setSignedAt(null);
        setMaskedTin(null);
        setDownloadUrl(null);
      } else {
        setStatus("signed");
        setSignedAt(data.signedAt ?? null);
        setMaskedTin(data.tin?.masked ?? null);
        setDownloadUrl(data.file?.signedUrl ?? null);

        setLegalName(data.profile?.legalName ?? "");
        setBusinessName(data.profile?.businessName ?? "");
        setEntityType(data.profile?.entityType ?? "Individual/sole proprietor");
        setAddress1(data.profile?.address1 ?? "");
        setAddress2(data.profile?.address2 ?? "");
        setCity(data.profile?.city ?? "");
        setStateCode((data.profile?.state ?? "NJ").toUpperCase());
        setZip(data.profile?.zip ?? "");
        setSignedName(data.profile?.signedName ?? data.profile?.legalName ?? "");
      }

      setTin("");
    } catch (e: any) {
      Alert.alert(alertTitle, e?.message ?? t("driver.w9.loadFailed", "Failed to load"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [alertTitle, t]);

  useEffect(() => {
    void load("init");
  }, [load]);

  const onDownload = useCallback(async () => {
    try {
      if (!downloadUrl) {
        Alert.alert(alertTitle, t("driver.w9.noPdf", "No PDF available yet."));
        return;
      }
      await openW9Pdf(downloadUrl);
    } catch (e: any) {
      Alert.alert(alertTitle, e?.message ?? t("driver.w9.openPdfFailed", "Unable to open PDF"));
    }
  }, [alertTitle, downloadUrl, t]);

  const onSubmit = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const payload: W9Payload = {
        legal_name: legalName.trim(),
        business_name: businessName.trim() || undefined,
        entity_type: entityType.trim(),
        address_line1: address1.trim(),
        address_line2: address2.trim() || undefined,
        city: city.trim(),
        state: stateCode.trim().toUpperCase(),
        zip: zip.trim(),
        tin_type: tinType,
        signed_name: signedName.trim(),
      };

      if (hasTinInput) payload.tin = tin;

      await w9Submit(payload);

      Alert.alert(alertTitle, t("driver.w9.saved", "Saved."));
      setTin("");
      await load("refresh");
    } catch (e: any) {
      Alert.alert(alertTitle, e?.message ?? t("driver.w9.submitFailed", "Submit failed"));
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting,
    legalName,
    businessName,
    entityType,
    address1,
    address2,
    city,
    stateCode,
    zip,
    tinType,
    signedName,
    hasTinInput,
    tin,
    load,
    alertTitle,
    t,
  ]);

  const tinPlaceholder =
    status === "signed"
      ? t("driver.w9.tinKeepCurrent", "Leave blank to keep current TIN")
      : tinType === "SSN"
        ? "123-45-6789"
        : "12-3456789";

  const formattedSignedAt = signedAt
    ? formatDateTime(signedAt, i18n.language, { dateStyle: "medium", timeStyle: undefined })
    : dash;

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={alertTitle}
        fallbackRoute="DriverTabs"
        variant="dark"
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <Text style={[styles.cardTitle, { textAlign: textAlignStart() }]}>
            {t("driver.w9.status", "Status")}
          </Text>

          {loading ? (
            <Text style={styles.muted}>{t("common.loading", "Loading…")}</Text>
          ) : (
            <>
              <View style={[styles.row, { flexDirection: rowDirection() }]}>
                <Text style={[styles.rowLabel, { textAlign: textAlignStart() }]}>
                  {t("driver.w9.statusLabel", "W-9 status")}
                </Text>
                <View style={[styles.rowRight, { flexDirection: rowDirection() }]}>
                  <View
                    style={[
                      styles.badge,
                      badgeStyle(status === "signed" ? "ok" : "warn"),
                    ]}
                  >
                    <Text style={styles.badgeText}>
                      {status === "signed"
                        ? t("driver.w9.signed", "Signed")
                        : t("driver.w9.missing", "Missing")}
                    </Text>
                  </View>
                </View>
              </View>

              {status === "signed" ? (
                <>
                  <View style={[styles.row, { flexDirection: rowDirection() }]}>
                    <Text style={[styles.rowLabel, { textAlign: textAlignStart() }]}>
                      {t("driver.w9.signedDate", "Signed date")}
                    </Text>
                    <Text style={styles.rowValue}>{formattedSignedAt}</Text>
                  </View>

                  <View style={[styles.row, styles.rowLast, { flexDirection: rowDirection() }]}>
                    <Text style={[styles.rowLabel, { textAlign: textAlignStart() }]}>
                      {t("driver.w9.tinMasked", "TIN (masked)")}
                    </Text>
                    <Text style={styles.rowValue}>{maskedTin ?? dash}</Text>
                  </View>
                </>
              ) : (
                <View style={[styles.row, styles.rowLast, { flexDirection: rowDirection() }]}>
                  <Text style={[styles.muted, { textAlign: textAlignStart() }]}>
                    {t("driver.w9.completeForm", "Complete the form below to sign your W-9.")}
                  </Text>
                </View>
              )}

              <View style={{ flexDirection: rowDirection(), gap: 10, marginTop: 12 }}>
                <TouchableOpacity
                  onPress={() => load("refresh")}
                  style={styles.primaryBtn}
                  activeOpacity={0.85}
                  disabled={refreshing || submitting}
                >
                  <Text style={styles.primaryBtnText}>
                    {refreshing
                      ? t("driver.w9.refreshing", "Refreshing…")
                      : t("common.refresh", "Refresh")}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={onDownload}
                  style={[styles.secondaryBtn, !downloadUrl && { opacity: 0.6 }]}
                  activeOpacity={0.85}
                  disabled={!downloadUrl}
                >
                  <Text style={styles.secondaryBtnText}>
                    {t("driver.w9.downloadPdf", "Download W-9 PDF")}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}
        </View>

        <View style={styles.card}>
          <Text style={[styles.cardTitle, { textAlign: textAlignStart() }]}>
            {t("driver.w9.checklist", "Checklist")}
          </Text>
          <Text style={[styles.muted, { textAlign: textAlignStart() }]}>
            {t("driver.w9.checklistHint", "Required fields must be complete.")}
          </Text>

          <View style={{ marginTop: 10 }}>
            <Row label={t("driver.w9.legalName", "Legal name")} ok={required.legalOk} />
            <Row label={t("driver.w9.entityType", "Entity type")} ok={required.entityOk} />
            <Row label={t("driver.w9.address1", "Address line 1")} ok={required.addrOk} />
            <Row label={t("driver.w9.city", "City")} ok={required.cityOk} />
            <Row label={t("driver.w9.state", "State")} ok={required.stateOk} />
            <Row label={t("driver.w9.zip", "ZIP")} ok={required.zipOk} />
            <Row
              label={t("driver.w9.tinTypeLabel", "TIN ({{type}})", { type: tinType })}
              ok={required.tinOk}
              hint={
                status === "signed"
                  ? t("driver.w9.tinOptionalHint", "Optional (blank keeps current)")
                  : t("driver.w9.tinRequiredHint", "Required (9 digits)")
              }
            />
            <Row label={t("driver.w9.signedName", "Signed name")} ok={required.signOk} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={[styles.cardTitle, { textAlign: textAlignStart() }]}>
            {t("driver.w9.formTitle", "W-9 form")}
          </Text>
          <Text style={[styles.muted, { textAlign: textAlignStart() }]}>
            {t(
              "driver.w9.tinPrivacy",
              "Your full TIN is never shown back to you. We only display masked last 4 digits."
            )}
          </Text>

          <View style={{ height: 12 }} />

          <Field
            label={t("driver.w9.legalNameRequired", "Legal name (required)")}
            value={legalName}
            onChangeText={setLegalName}
          />
          <Field
            label={t("driver.w9.businessNameOptional", "Business name (optional)")}
            value={businessName}
            onChangeText={setBusinessName}
          />
          <Field
            label={t("driver.w9.entityTypeRequired", "Entity type (required)")}
            value={entityType}
            onChangeText={setEntityType}
          />

          <Field
            label={t("driver.w9.address1Required", "Address line 1 (required)")}
            value={address1}
            onChangeText={setAddress1}
          />
          <Field
            label={t("driver.w9.address2Optional", "Address line 2 (optional)")}
            value={address2}
            onChangeText={setAddress2}
          />

          <Field
            label={t("driver.w9.cityRequired", "City (required)")}
            value={city}
            onChangeText={setCity}
          />
          <Field
            label={t("driver.w9.stateRequired", "State (required)")}
            value={stateCode}
            onChangeText={(v) => setStateCode(v.toUpperCase())}
          />
          <Field
            label={t("driver.w9.zipRequired", "ZIP (required)")}
            value={zip}
            onChangeText={setZip}
            keyboardType="number-pad"
          />

          <Text style={[styles.fieldLabel, { textAlign: textAlignStart() }]}>
            {t("driver.w9.tinType", "TIN type")}
          </Text>
          <View style={{ flexDirection: rowDirection(), gap: 10, marginTop: 8, marginBottom: 12 }}>
            <TouchableOpacity
              onPress={() => setTinType("SSN")}
              activeOpacity={0.85}
              style={[styles.chip, tinType === "SSN" ? styles.chipActive : styles.chipInactive]}
            >
              <Text style={[styles.chipText, tinType === "SSN" ? styles.chipTextActive : styles.chipTextInactive]}>
                SSN
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setTinType("EIN")}
              activeOpacity={0.85}
              style={[styles.chip, tinType === "EIN" ? styles.chipActive : styles.chipInactive]}
            >
              <Text style={[styles.chipText, tinType === "EIN" ? styles.chipTextActive : styles.chipTextInactive]}>
                EIN
              </Text>
            </TouchableOpacity>
          </View>

          <Field
            label={
              status === "signed"
                ? t("driver.w9.tinOptional", "TIN (optional • 9 digits)")
                : t("driver.w9.tinRequired", "TIN (required • 9 digits)")
            }
            value={tin}
            onChangeText={setTin}
            placeholder={tinPlaceholder}
            keyboardType="number-pad"
          />

          <Field
            label={t("driver.w9.signedNameRequired", "Signed name (required)")}
            value={signedName}
            onChangeText={setSignedName}
          />

          <TouchableOpacity
            onPress={onSubmit}
            disabled={!required.all || submitting || loading}
            style={[
              styles.submitBtn,
              (!required.all || submitting || loading) && { opacity: 0.65 },
            ]}
            activeOpacity={0.85}
          >
            <View style={{ flexDirection: rowDirection(), alignItems: "center", gap: 10 }}>
              {submitting ? <ActivityIndicator size="small" color="rgba(255,255,255,0.9)" /> : null}
              <Text style={styles.submitText}>
                {submitting ? t("driver.w9.submitting", "Submitting…") : submitLabel}
              </Text>
            </View>
          </TouchableOpacity>

          <Text style={[styles.smallNote, { textAlign: textAlignStart() }]}>
            {t(
              "driver.w9.certification",
              "By submitting, you certify under penalties of perjury that the TIN is correct and you are a U.S. person (or U.S. resident alien)."
            )}
          </Text>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#050A14" },

  header: {
    paddingTop: Platform.OS === "android" ? 12 : 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
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
    fontWeight: "800",
  },

  title: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 16,
    fontWeight: "900",
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
    fontWeight: "900",
    marginBottom: 10,
  },

  muted: {
    color: "rgba(255,255,255,0.62)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },

  row: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
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
    alignItems: "center",
    justifyContent: "flex-end",
  },

  rowValue: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 13,
    fontWeight: "900",
  },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },

  badgeText: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 12,
    fontWeight: "900",
  },

  primaryBtn: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
  },

  primaryBtnText: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 13,
    fontWeight: "900",
  },

  secondaryBtn: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
  },

  secondaryBtnText: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    fontWeight: "900",
  },

  checkRow: {
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },

  checkLabel: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontWeight: "800",
  },

  checkHint: {
    marginTop: 4,
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "600",
  },

  checkIcon: { fontSize: 16 },

  fieldLabel: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 6,
  },

  input: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(0,0,0,0.22)",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontWeight: "700",
    color: "rgba(255,255,255,0.92)",
  },

  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },

  chipActive: {
    backgroundColor: "rgba(255,255,255,0.16)",
    borderColor: "rgba(255,255,255,0.22)",
  },

  chipInactive: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderColor: "rgba(255,255,255,0.10)",
  },

  chipText: { fontSize: 13, fontWeight: "900" },
  chipTextActive: { color: "rgba(255,255,255,0.95)" },
  chipTextInactive: { color: "rgba(255,255,255,0.78)" },

  submitBtn: {
    marginTop: 6,
    backgroundColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },

  submitText: {
    color: "rgba(255,255,255,0.95)",
    fontSize: 14,
    fontWeight: "900",
  },

  smallNote: {
    marginTop: 10,
    color: "rgba(255,255,255,0.55)",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },
});
