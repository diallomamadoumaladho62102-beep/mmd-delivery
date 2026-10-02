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

const WAIT_FALLBACK: Record<string, string> = {
  restaurant_delay: "Restaurant delay",
  order_issue: "Order issue",
  traffic: "Traffic",
  gps_issue: "GPS issue",
  technical_issue: "Technical issue",
  vehicle_issue: "Vehicle issue",
  safety_issue: "Safety issue",
  other: "Other",
};

const DISPUTE_FALLBACK: Record<string, string> = {
  restaurant: "Restaurant",
  wait: "Wait",
  gps: "GPS",
  technical: "Technical",
  other: "Other",
};

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
    (key: string, fallback: string, vars?: Record<string, unknown>) =>
      String(t(key, { defaultValue: fallback, ...(vars ?? {}) })),
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
        setError(tr("driver.integrity.unauthorized", "You cannot report this trip."));
        return;
      }
      setWaitReasons(wait.reasons ?? Object.keys(WAIT_FALLBACK));
      setDisputeReasons(dispute.reasons ?? Object.keys(DISPUTE_FALLBACK));
      setCurrentWait(wait.current?.reason_code ?? null);
      setCurrentDispute(dispute.current?.reason_code ?? null);
      setIncidentClosed(Boolean(dispute.incident_closed));
    } catch (e) {
      if (!mountedRef.current) return;
      const message = toUserFacingError(e, String(e));
      setError(
        isNetworkError(message)
          ? tr("driver.integrity.networkError", "Unstable connection. Try again.")
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
          ? tr("driver.integrity.alreadySubmittedTitle", "Already submitted")
          : tr("driver.integrity.waitSubmittedTitle", "Wait reason sent"),
        tr(
          "driver.integrity.waitSubmittedBody",
          "Your reason was recorded. Trip times were not changed."
        )
      );
    } catch (e) {
      if (!mountedRef.current) return;
      const message = toUserFacingError(e, String(e));
      setError(
        isNetworkError(message)
          ? tr("driver.integrity.networkError", "Unstable connection. Try again.")
          : message
      );
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(null);
    }
  }

  async function onSubmitDispute() {
    if (!selectedDispute || submittingRef.current) return;
    if (incidentClosed) {
      setError(tr("driver.integrity.incidentClosed", "This trip review is already closed."));
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
          ? tr("driver.integrity.alreadySubmittedTitle", "Already submitted")
          : tr("driver.integrity.disputeSubmittedTitle", "Dispute opened"),
        tr(
          "driver.integrity.disputeSubmittedBody",
          "Your dispute was recorded. Earnings and trip times were not changed."
        )
      );
    } catch (e) {
      if (!mountedRef.current) return;
      const err = e as { code?: string; message?: string };
      if (err.code === "incident_closed") {
        setIncidentClosed(true);
        setError(tr("driver.integrity.incidentClosed", "This trip review is already closed."));
      } else {
        const message = toUserFacingError(e, String(e));
        setError(
          isNetworkError(message)
            ? tr("driver.integrity.networkError", "Unstable connection. Try again.")
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
      accessibilityLabel={tr("driver.integrity.title", "Trip report")}
    >
      <Text style={styles.title}>{tr("driver.integrity.title", "Report a wait or dispute")}</Text>
      <Text style={styles.hint}>
        {tr(
          "driver.integrity.hint",
          "Choose a reason from the official list. You cannot change trip times or earnings."
        )}
      </Text>

      {currentWait ? (
        <Text style={styles.status}>
          {tr("driver.integrity.currentWait", "Current wait reason: {{reason}}", {
            reason: tr(`driver.integrity.wait.${currentWait}`, WAIT_FALLBACK[currentWait] ?? currentWait),
          })}
        </Text>
      ) : null}
      {currentDispute ? (
        <Text style={styles.status}>
          {tr("driver.integrity.currentDispute", "Dispute on file: {{reason}}", {
            reason: tr(
              `driver.integrity.dispute.${currentDispute}`,
              DISPUTE_FALLBACK[currentDispute] ?? currentDispute
            ),
          })}
        </Text>
      ) : null}

      {loading ? <ActivityIndicator color="#0037A0" /> : null}
      {error ? (
        <Pressable
          onPress={() => void refresh()}
          accessibilityRole="button"
          accessibilityLabel={tr("driver.integrity.retry", "Try again")}
          style={styles.retry}
        >
          <Text style={styles.retryText}>{error}</Text>
          <Text style={styles.retryAction}>{tr("driver.integrity.retry", "Try again")}</Text>
        </Pressable>
      ) : null}

      <Text style={styles.section}>{tr("driver.integrity.waitSection", "Wait reason")}</Text>
      <View style={styles.chips}>
        {waitReasons.map((code) => (
          <Pressable
            key={code}
            onPress={() => setSelectedWait(code)}
            disabled={Boolean(submitting)}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedWait === code }}
            accessibilityLabel={tr(`driver.integrity.wait.${code}`, WAIT_FALLBACK[code] ?? code)}
            style={[styles.chip, selectedWait === code ? styles.chipOn : null]}
          >
            <Text style={[styles.chipText, selectedWait === code ? styles.chipTextOn : null]}>
              {tr(`driver.integrity.wait.${code}`, WAIT_FALLBACK[code] ?? code)}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        onPress={() => void onSubmitWait()}
        disabled={!selectedWait || Boolean(submitting)}
        accessibilityRole="button"
        accessibilityLabel={tr("driver.integrity.submitWait", "Submit wait reason")}
        style={[styles.button, !selectedWait || submitting ? styles.buttonDisabled : null]}
      >
        {submitting === "wait" ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {tr("driver.integrity.submitWait", "Submit wait reason")}
          </Text>
        )}
      </Pressable>

      <Text style={styles.section}>{tr("driver.integrity.disputeSection", "Open a dispute")}</Text>
      <View style={styles.chips}>
        {disputeReasons.map((code) => (
          <Pressable
            key={code}
            onPress={() => setSelectedDispute(code)}
            disabled={Boolean(submitting) || incidentClosed}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedDispute === code, disabled: incidentClosed }}
            accessibilityLabel={tr(`driver.integrity.dispute.${code}`, DISPUTE_FALLBACK[code] ?? code)}
            style={[styles.chip, selectedDispute === code ? styles.chipOn : null]}
          >
            <Text style={[styles.chipText, selectedDispute === code ? styles.chipTextOn : null]}>
              {tr(`driver.integrity.dispute.${code}`, DISPUTE_FALLBACK[code] ?? code)}
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={explanation}
        onChangeText={setExplanation}
        placeholder={tr("driver.integrity.explanation", "Optional explanation")}
        placeholderTextColor="#94A3B8"
        accessibilityLabel={tr("driver.integrity.explanation", "Optional explanation")}
        multiline
        style={styles.input}
      />
      <Pressable
        onPress={() => void onSubmitDispute()}
        disabled={!selectedDispute || Boolean(submitting) || incidentClosed}
        accessibilityRole="button"
        accessibilityLabel={tr("driver.integrity.submitDispute", "Submit dispute")}
        style={[
          styles.button,
          !selectedDispute || submitting || incidentClosed ? styles.buttonDisabled : null,
        ]}
      >
        {submitting === "dispute" ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>
            {tr("driver.integrity.submitDispute", "Submit dispute")}
          </Text>
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
