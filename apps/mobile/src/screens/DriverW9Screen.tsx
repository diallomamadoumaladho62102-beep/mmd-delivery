/**
 * Driver W-9 — Figma 308:6808 Loading / 308:6821 Missing / 308:6925 Signed.
 * Keeps w9Get / w9Submit / openW9Pdf + RTL Field/Row helpers.
 */
import { toUserFacingError } from "../lib/userFacingError";
import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import ScreenHeader from "../components/navigation/ScreenHeader";
import { DriverBrandLoadingState } from "../components/driver/DriverBrandLoadingState";

import { TinType, W9GetResponse, W9Payload, openW9Pdf, w9Get, w9Submit } from "../../lib/taxW9";
import { rowDirection, textAlignStart } from "../i18n/rtl";
import { formatDateTime } from "../i18n/formatters";
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
const RED = "#EF4444";
const INPUT_BG = "rgba(255,255,255,0.1)";
const INPUT_BORDER = "rgba(255,255,255,0.2)";

function onlyDigits(s: string) {
  return String(s || "").replace(/\D+/g, "");
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

function Row({ label, ok, hint }: { label: string; ok: boolean; hint?: string }) {
  return (
    <View style={[styles.checkRow, { flexDirection: rowDirection() }]}>
      <View style={{ flex: 1, paddingRight: 10 }}>
        <Text style={[styles.checkLabel, { textAlign: textAlignStart() }]}>{label}</Text>
        {hint ? (
          <Text style={[styles.checkHint, { textAlign: textAlignStart() }]}>{hint}</Text>
        ) : null}
      </View>
      <Text style={[styles.checkIcon, { color: ok ? MMD_TAXI_GREEN : RED }]}>
        {ok ? "✅" : "❌"}
      </Text>
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
      Alert.alert(alertTitle, toUserFacingError(e, t("driver.w9.loadFailed", "Failed to load")));
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
      Alert.alert(alertTitle, toUserFacingError(e, t("driver.w9.openPdfFailed", "Unable to open PDF")));
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
      Alert.alert(alertTitle, toUserFacingError(e, t("driver.w9.submitFailed", "Submit failed")));
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

  const checklistTinOk = status === "signed" ? true : required.tinOk;

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title={t("driver.w9.formScreenTitle", "Formulaire W-9")}
          fallbackRoute="DriverTabs"
          variant="mmd"
        />
        <DriverBrandLoadingState
          title={t("driver.w9.loadingForm", "Chargement du formulaire W-9...")}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={t("driver.w9.formScreenTitle", "Formulaire W-9")}
        subtitle={status === "missing" ? "MMD Delivery" : undefined}
        fallbackRoute="DriverTabs"
        variant="mmd"
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.card}>
          <View style={[styles.statusHeader, { flexDirection: rowDirection() }]}>
            <Text style={[styles.cardTitle, { textAlign: textAlignStart(), marginBottom: 0 }]}>
              {t("driver.w9.status", "Statut W-9")}
            </Text>
            {status === "signed" ? (
              <View style={styles.badgeSigned}>
                <Text style={styles.badgeSignedText}>
                  ✅ {t("driver.w9.signed", "Signé")}
                </Text>
              </View>
            ) : null}
          </View>

          {status === "signed" ? (
            <View style={styles.signedMeta}>
              <Text style={[styles.metaLine, { textAlign: textAlignStart() }]}>
                {t("driver.w9.signedDate", "Date de signature")}: {formattedSignedAt}
              </Text>
              <Text style={[styles.metaLine, { textAlign: textAlignStart() }]}>
                {t("driver.w9.tinMasked", "TIN (masqué)")}: {maskedTin ?? dash}
              </Text>
            </View>
          ) : (
            <>
              <View style={[styles.statusRow, { flexDirection: rowDirection() }]}>
                <Text style={[styles.statusLabel, { textAlign: textAlignStart() }]}>
                  {t("driver.w9.statusLabel", "Statut du formulaire")}
                </Text>
                <View style={styles.badgeMissing}>
                  <Text style={styles.badgeMissingText}>
                    {t("driver.w9.missing", "Non signé")}
                  </Text>
                </View>
              </View>
              <Text style={[styles.completeHint, { textAlign: textAlignStart() }]}>
                {t("driver.w9.completeForm", "Complete the form below to sign your W-9.")}
              </Text>
            </>
          )}

          <View style={[styles.actionRow, { flexDirection: rowDirection() }]}>
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
              style={[styles.ghostBtn, !downloadUrl && { opacity: 0.6 }]}
              activeOpacity={0.85}
              disabled={!downloadUrl}
            >
              <Text style={styles.ghostBtnText}>
                {t("driver.w9.downloadPdf", "Télécharger PDF")}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={[styles.cardTitle, { textAlign: textAlignStart() }]}>
            ✅ {t("driver.w9.checklist", "Liste de vérification")}
          </Text>

          <View style={{ marginTop: 2 }}>
            <Row label={t("driver.w9.legalName", "Legal name")} ok={required.legalOk} />
            <Row label={t("driver.w9.entityType", "Entity type")} ok={required.entityOk} />
            <Row label={t("driver.w9.address1", "Address line 1")} ok={required.addrOk} />
            <Row label={t("driver.w9.city", "City")} ok={required.cityOk} />
            <Row label={t("driver.w9.state", "State")} ok={required.stateOk} />
            <Row label={t("driver.w9.zip", "ZIP")} ok={required.zipOk} />
            <Row
              label={t("driver.w9.tinTypeLabel", "TIN ({{type}})", { type: tinType })}
              ok={checklistTinOk}
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
            📝 {t("driver.w9.formTitle", "Formulaire W-9")}
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
              <Text style={styles.chipText}>SSN</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setTinType("EIN")}
              activeOpacity={0.85}
              style={[styles.chip, tinType === "EIN" ? styles.chipActive : styles.chipInactive]}
            >
              <Text style={styles.chipText}>EIN</Text>
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
            disabled={!required.all || submitting}
            style={[
              styles.submitBtn,
              (!required.all || submitting) && { opacity: 0.65 },
            ]}
            activeOpacity={0.85}
          >
            <View style={{ flexDirection: rowDirection(), alignItems: "center", gap: 10 }}>
              {submitting ? <ActivityIndicator size="small" color={MMD_BLUE} /> : null}
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

        <BrandFooter />
      </ScrollView>
    </SafeAreaView>
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
    borderRadius: 16,
    padding: 16,
  },
  cardTitle: {
    color: MMD_WHITE,
    fontSize: 16,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    marginBottom: 12,
  },
  statusHeader: {
    alignItems: "center",
    gap: 8,
    marginBottom: 12,
  },
  statusRow: {
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  statusLabel: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    flex: 1,
    paddingRight: 8,
  },
  badgeMissing: {
    backgroundColor: "rgba(239,68,68,0.1)",
    borderWidth: 1,
    borderColor: RED,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeMissingText: {
    color: RED,
    fontSize: 12,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  badgeSigned: {
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeSignedText: {
    color: MMD_BLUE,
    fontSize: 12,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
  },
  signedMeta: { gap: 4, marginBottom: 12 },
  metaLine: {
    color: "rgba(255,255,255,0.72)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
    fontWeight: "400",
  },
  completeHint: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 13,
    fontFamily: MMD_FONT.regular,
    fontWeight: "400",
    marginBottom: 12,
  },
  actionRow: { gap: 12 },
  primaryBtn: {
    flex: 1,
    backgroundColor: MMD_TAXI_GREEN,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  primaryBtnText: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  ghostBtn: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  ghostBtnText: {
    color: MMD_WHITE,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  muted: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 12,
    fontFamily: MMD_FONT.regular,
    fontWeight: "400",
    lineHeight: 16,
  },
  checkRow: {
    alignItems: "center",
    paddingVertical: 8,
  },
  checkLabel: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    fontWeight: "400",
  },
  checkHint: {
    marginTop: 4,
    color: MMD_MUTED,
    fontSize: 12,
    fontFamily: MMD_FONT.regular,
    fontWeight: "400",
  },
  checkIcon: { fontSize: 18 },
  fieldLabel: {
    color: MMD_WHITE,
    fontSize: 13,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: INPUT_BORDER,
    backgroundColor: INPUT_BG,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 42,
    fontSize: 14,
    fontFamily: MMD_FONT.regular,
    fontWeight: "400",
    color: MMD_WHITE,
  },
  chip: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
  },
  chipActive: {
    backgroundColor: "rgba(255,255,255,0.16)",
    borderColor: "rgba(255,255,255,0.25)",
  },
  chipInactive: {
    backgroundColor: INPUT_BG,
    borderColor: INPUT_BORDER,
  },
  chipText: {
    color: MMD_WHITE,
    fontSize: 13,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  submitBtn: {
    marginTop: 6,
    backgroundColor: MMD_TAXI_GREEN,
    minHeight: 44,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  submitText: {
    color: MMD_BLUE,
    fontSize: 14,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
  },
  smallNote: {
    marginTop: 10,
    color: "rgba(255,255,255,0.5)",
    fontSize: 11,
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
    width: 40,
    height: 40,
    borderRadius: 10,
  },
  footerBrand: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
});
