import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import {
  checkPhoneVerificationRequest,
  startPhoneVerificationRequest,
} from "@mmd/phone-verify-api";
import { getApiBaseUrl } from "../../lib/apiBase";
import { supabase } from "../../lib/supabase";

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
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (verified) {
    return (
      <View style={styles.verifiedBox}>
        <Text style={styles.verifiedText}>Phone verified</Text>
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
      setError(started.error || "Unable to send code");
      return;
    }
    setNotice("Verification code sent by SMS.");
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
      setError(checked.error || "Invalid code");
      return;
    }
    setNotice("Phone verified.");
    onVerified?.(String(checked.phone_e164 ?? phone));
  }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Verify phone (Twilio Verify)</Text>
      <Text style={styles.hint}>
        Required for full access when PHONE_OTP_ENABLED is on.
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
            <Text style={styles.btnPrimaryText}>Send SMS code</Text>
          )}
        </TouchableOpacity>
        <TextInput
          value={code}
          onChangeText={setCode}
          placeholder="Code"
          placeholderTextColor="#94A3B8"
          keyboardType="number-pad"
          style={styles.codeInput}
        />
        <TouchableOpacity
          style={[styles.btnSecondary, (busy || !code.trim()) && styles.disabled]}
          disabled={busy || !code.trim()}
          onPress={() => void check()}
        >
          <Text style={styles.btnSecondaryText}>Confirm</Text>
        </TouchableOpacity>
      </View>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: "#E2E8F0",
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    padding: 12,
    gap: 6,
    marginTop: 8,
  },
  verifiedBox: {
    borderWidth: 1,
    borderColor: "#A7F3D0",
    backgroundColor: "#ECFDF5",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  verifiedText: { color: "#065F46", fontSize: 13, fontWeight: "600" },
  title: { color: "#1E293B", fontSize: 14, fontWeight: "700" },
  hint: { color: "#64748B", fontSize: 12 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "center" },
  btnPrimary: {
    backgroundColor: "#0F172A",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minWidth: 110,
    alignItems: "center",
  },
  btnPrimaryText: { color: "#fff", fontSize: 12, fontWeight: "700" },
  btnSecondary: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  btnSecondaryText: { color: "#0F172A", fontSize: 12, fontWeight: "700" },
  codeInput: {
    width: 96,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: "#0F172A",
    backgroundColor: "#fff",
  },
  disabled: { opacity: 0.5 },
  notice: { color: "#047857", fontSize: 12 },
  error: { color: "#DC2626", fontSize: 12 },
});

export default PhoneVerifyCard;
