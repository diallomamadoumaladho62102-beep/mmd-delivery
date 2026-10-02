import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  fetchDisputeCatalog,
  fetchWaitReasonCatalog,
  submitDispute,
  submitWaitReason,
  type DriverIntegrityEntityType,
} from "../../lib/driverIntegrityApi";

type Props = {
  entityType: DriverIntegrityEntityType;
  entityId: string;
};

function labelOrCode(translated: string, key: string, code: string): string {
  if (!translated || translated === key) return code;
  return translated;
}

function isNetworkError(message: string): boolean {
  return /network|fetch|timeout|failed to fetch|connection|not authenticated/i.test(message);
}

export function DriverIntegrityReportPanel({ entityType, entityId }: Props) {
  const { t } = useTranslation();
  const mountedRef = useRef(true);
  const submittingRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<"wait" | "dispute" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waitReasons, setWaitReasons] = useState<string[]>([]);
  const [disputeReasons, setDisputeReasons] = useState<string[]>([]);
  const [currentWait, setCurrentWait] = useState<string | null>(null);
  const [currentDispute, setCurrentDispute] = useState<string | null>(null);
  const [incidentClosed, setIncidentClosed] = useState(false);
  const [selectedWait, setSelectedWait] = useState<string | null>(null);
  const [selectedDispute, setSelectedDispute] = useState<string | null>(null);
  const [explanation, setExplanation] = useState("");

  const tr = useCallback(
    (key: string, vars?: Record<string, unknown>) => String(t(key, vars)),
    [t]
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [wait, dispute] = await Promise.all([
        fetchWaitReasonCatalog({ entityType, entityId }),
        fetchDisputeCatalog({ entityType, entityId }),
      ]);
      if (!mountedRef.current) return;
      if (wait.ok === false && wait.error === "forbidden") {
        setError(tr("driver.integrity.unauthorized"));
        return;
      }
      setWaitReasons(wait.reasons ?? []);
      setDisputeReasons(dispute.reasons ?? []);
      setCurrentWait(wait.current?.reason_code ?? null);
      setCurrentDispute(dispute.current?.reason_code ?? null);
      setIncidentClosed(Boolean(dispute.incident_closed));
    } catch (e) {
      if (!mountedRef.current) return;
      const message = toUserFacingError(e, String(e));
      setError(
        isNetworkError(message)
          ? tr("driver.integrity.networkError")
          : message
      );
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [entityId, entityType, tr]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSubmitWait() {
    if (!selectedWait || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting("wait");
    setError(null);
    try {
      const result = await submitWaitReason({
        entityType,
        entityId,
        reasonCode: selectedWait,
        explanation: explanation.trim() || undefined,
      });
      if (!mountedRef.current) return;
      setCurrentWait(selectedWait);
      Alert.alert(
        result.already_submitted
          ? tr("driver.integrity.alreadySubmittedTitle")
          : tr("driver.integrity.waitSubmittedTitle"),
        tr("driver.integrity.waitSubmittedBody")
      );
    } catch (e) {
      if (!mountedRef.current) return;
      const message = toUserFacingError(e, String(e));
      setError(
        isNetworkError(message) ? tr("driver.integrity.networkError") : message
      );
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(null);
    }
  }

  async function onSubmitDispute() {
    if (!selectedDispute || submittingRef.current) return;
    if (incidentClosed) {
      setError(tr("driver.integrity.incidentClosed"));
      return;
    }
    submittingRef.current = true;
    setSubmitting("dispute");
    setError(null);
    try {
      const result = await submitDispute({
        entityType,
        entityId,
        reasonCode: selectedDispute,
        explanation: explanation.trim() || undefined,
      });
      if (!mountedRef.current) return;
      setCurrentDispute(selectedDispute);
      Alert.alert(
        result.already_submitted
          ? tr("driver.integrity.alreadySubmittedTitle")
          : tr("driver.integrity.disputeSubmittedTitle"),
        tr("driver.integrity.disputeSubmittedBody")
      );
    } catch (e) {
      if (!mountedRef.current) return;
      const err = e as { code?: string; message?: string };
      if (err.code === "incident_closed") {
        setIncidentClosed(true);
        setError(tr("driver.integrity.incidentClosed"));
      } else {
        const message = toUserFacingError(e, String(e));
        setError(
          isNetworkError(message)
            ? tr("driver.integrity.networkError")
            : message
        );
      }
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(null);
    }
  }

  return (
    <View
      style={styles.card}
      accessibilityRole="summary"
      accessibilityLabel={tr("driver.integrity.title")}
    >
      <Text style={styles.title}>{tr("driver.integrity.title")}</Text>
      <Text style={styles.hint}>{tr("driver.integrity.hint")}</Text>

      {currentWait ? (
        <Text style={styles.status}>
          {tr("driver.integrity.currentWait", {
            reason: labelOrCode(
              tr(`driver.integrity.wait.${currentWait}`),
              `driver.integrity.wait.${currentWait}`,
              currentWait
            ),
          })}
        </Text>
      ) : null}
      {currentDispute ? (
        <Text style={styles.status}>
          {tr("driver.integrity.currentDispute", {
            reason: labelOrCode(
              tr(`driver.integrity.dispute.${currentDispute}`),
              `driver.integrity.dispute.${currentDispute}`,
              currentDispute
            ),
          })}
        </Text>
      ) : null}

      {loading ? <ActivityIndicator color="#0037A0" /> : null}
      {error ? (
        <Pressable
          onPress={() => void refresh()}
          accessibilityRole="button"
          accessibilityLabel={tr("driver.integrity.retry")}
          style={styles.retry}
        >
          <Text style={styles.retryText}>{error}</Text>
          <Text style={styles.retryAction}>{tr("driver.integrity.retry")}</Text>
        </Pressable>
      ) : null}

      <Text style={styles.section}>{tr("driver.integrity.waitSection")}</Text>
      <View style={styles.chips}>
        {waitReasons.map((code) => (
          <Pressable
            key={code}
            onPress={() => setSelectedWait(code)}
            disabled={Boolean(submitting)}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedWait === code }}
            accessibilityLabel={labelOrCode(
              tr(`driver.integrity.wait.${code}`),
              `driver.integrity.wait.${code}`,
              code
            )}
            style={[styles.chip, selectedWait === code ? styles.chipOn : null]}
          >
            <Text style={[styles.chipText, selectedWait === code ? styles.chipTextOn : null]}>
              {labelOrCode(
                tr(`driver.integrity.wait.${code}`),
                `driver.integrity.wait.${code}`,
                code
              )}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        onPress={() => void onSubmitWait()}
        disabled={!selectedWait || Boolean(submitting)}
        accessibilityRole="button"
        accessibilityLabel={tr("driver.integrity.submitWait")}
        style={[styles.button, !selectedWait || submitting ? styles.buttonDisabled : null]}
      >
        {submitting === "wait" ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{tr("driver.integrity.submitWait")}</Text>
        )}
      </Pressable>

      <Text style={styles.section}>{tr("driver.integrity.disputeSection")}</Text>
      <View style={styles.chips}>
        {disputeReasons.map((code) => (
          <Pressable
            key={code}
            onPress={() => setSelectedDispute(code)}
            disabled={Boolean(submitting) || incidentClosed}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedDispute === code, disabled: incidentClosed }}
            accessibilityLabel={labelOrCode(
              tr(`driver.integrity.dispute.${code}`),
              `driver.integrity.dispute.${code}`,
              code
            )}
            style={[styles.chip, selectedDispute === code ? styles.chipOn : null]}
          >
            <Text style={[styles.chipText, selectedDispute === code ? styles.chipTextOn : null]}>
              {labelOrCode(
                tr(`driver.integrity.dispute.${code}`),
                `driver.integrity.dispute.${code}`,
                code
              )}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={explanation}
        onChangeText={setExplanation}
        placeholder={tr("driver.integrity.explanation")}
        placeholderTextColor="#94A3B8"
        accessibilityLabel={tr("driver.integrity.explanation")}
        multiline
        style={styles.input}
      />
      <Pressable
        onPress={() => void onSubmitDispute()}
        disabled={!selectedDispute || Boolean(submitting) || incidentClosed}
        accessibilityRole="button"
        accessibilityLabel={tr("driver.integrity.submitDispute")}
        style={[
          styles.button,
          !selectedDispute || submitting || incidentClosed ? styles.buttonDisabled : null,
        ]}
      >
        {submitting === "dispute" ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>{tr("driver.integrity.submitDispute")}</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    padding: 14,
    backgroundColor: "rgba(2,6,23,0.92)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.22)",
    gap: 10,
  },
  title: { color: "#F8FAFC", fontSize: 15, fontWeight: "800" },
  hint: { color: "#CBD5E1", fontSize: 12, lineHeight: 18 },
  status: { color: "#A5B4FC", fontSize: 12, fontWeight: "700" },
  section: { color: "#E2E8F0", fontSize: 13, fontWeight: "800", marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: 44,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(15,23,42,0.9)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.28)",
    justifyContent: "center",
  },
  chipOn: { backgroundColor: "rgba(0,55,160,0.85)", borderColor: "#93C5FD" },
  chipText: { color: "#E2E8F0", fontSize: 12, fontWeight: "700" },
  chipTextOn: { color: "#fff" },
  input: {
    minHeight: 72,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.28)",
    color: "#F8FAFC",
    padding: 12,
    textAlignVertical: "top",
  },
  button: {
    minHeight: 48,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0037A0",
  },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: "#fff", fontSize: 13, fontWeight: "800" },
  retry: { gap: 4 },
  retryText: { color: "#FCA5A5", fontSize: 12 },
  retryAction: { color: "#93C5FD", fontSize: 12, fontWeight: "800" },
});
