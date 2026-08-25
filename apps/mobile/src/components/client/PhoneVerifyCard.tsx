import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useTranslation } from "react-i18next";
import {
  checkPhoneVerificationRequest,
  startPhoneVerificationRequest,
} from "@mmd/phone-verify-api";
import { getApiBaseUrl } from "../../lib/apiBase";
import { supabase } from "../../lib/supabase";
import { toUserFacingError } from "../../lib/userFacingError";

type Props = {
  phone: string;
  verified: boolean;
  onVerified?: (phoneE164: string) => void;
};

async function getAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token?.trim() ?? "";
}

export function PhoneVerifyCard({ phone, verified, onVerified }: Props) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (verified) {
    return (
      <View style={styles.verifiedBox}>
        <Text style={styles.verifiedText}>
          {t("client.profile.phoneVerify.verified", "Phone verified")}
        </Text>
      </View>
    );
  }

  async function start() {
    setBusy(true);
    setError(null);
    setNotice(null);
    const token = await getAccessToken();
    const started = await startPhoneVerificationRequest({
      apiBaseUrl: getApiBaseUrl(),
      accessToken: token,
      phone,
    });
    setBusy(false);
    if (started.ok === false) {
      setError(
        toUserFacingError(
          started.error,
          t("client.profile.phoneVerify.sendFailed", "Unable to send code"),
        ),
      );
      return;
    }
    setNotice(
      t("client.profile.phoneVerify.codeSent", "Verification code sent by SMS."),
    );
  }

  async function check() {
    setBusy(true);
    setError(null);
    const token = await getAccessToken();
    const checked = await checkPhoneVerificationRequest({
      apiBaseUrl: getApiBaseUrl(),
      accessToken: token,
      phone,
      code,
    });
    setBusy(false);
    if (checked.ok === false) {
      setError(
        toUserFacingError(
          checked.error,
          t("client.profile.phoneVerify.invalidCode", "Invalid code"),
        ),
      );
      return;
    }
    setNotice(
      t("client.profile.phoneVerify.verifiedNotice", "Phone verified."),
    );
    onVerified?.(String(checked.phone_e164 ?? phone));
  }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>
        {t("client.profile.phoneVerify.title", "Verify your phone")}
      </Text>
      <Text style={styles.hint}>
        {t(
          "client.profile.phoneVerify.hint",
          "We will send an SMS code to confirm this number.",
        )}
      </Text>
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.btnPrimary, (busy || !phone.trim()) && styles.disabled]}
          disabled={busy || !phone.trim()}
          onPress={() => void start()}
        >
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.btnPrimaryText}>
              {t("client.profile.phoneVerify.sendCode", "Send SMS code")}
            </Text>
          )}
        </TouchableOpacity>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder={t("client.profile.phoneVerify.codePlaceholder", "Code")}
          placeholderTextColor="#94A3B8"
          keyboardType="number-pad"
          style={styles.codeInput}
        />
        <TouchableOpacity
          style={[styles.btnSecondary, (busy || !code.trim()) && styles.disabled]}
          disabled={busy || !code.trim()}
          onPress={() => void check()}
        >
          <Text style={styles.btnSecondaryText}>
            {t("client.profile.phoneVerify.confirm", "Confirm")}
          </Text>
        </TouchableOpacity>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.5)",
    backgroundColor: "#003399",
    borderRadius: 10,
    padding: 12,
    gap: 8,
    marginTop: 8,
  },
  verifiedBox: {
    borderWidth: 1.5,
    borderColor: "rgba(167,243,208,0.7)",
    backgroundColor: "#003399",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  verifiedText: { color: "#86EFAC", fontSize: 15, fontWeight: "600" },
  title: { color: "#FFFFFF", fontSize: 17, fontWeight: "600" },
  hint: { color: "rgba(255,255,255,0.85)", fontSize: 16 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  btnPrimary: {
    backgroundColor: "rgba(11,18,32,0.72)",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.35)",
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 110,
    alignItems: "center",
  },
  btnPrimaryText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  btnSecondary: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.5)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  btnSecondaryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700" },
  codeInput: {
    width: 96,
    borderWidth: 1.5,
    borderColor: "#FFFFFF",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "#FFFFFF",
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  disabled: { opacity: 0.5 },
  notice: { color: "#86EFAC", fontSize: 12 },
  error: { color: "#FCA5A5", fontSize: 12 },
});

export default PhoneVerifyCard;
