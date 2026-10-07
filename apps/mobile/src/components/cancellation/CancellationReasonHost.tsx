import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useTranslation } from "react-i18next";

export type CancelReasonNamespace =
  | "taxiClient"
  | "taxiDriver"
  | "deliveryClient"
  | "deliveryDriver"
  | "restaurant"
  | "seller";

type Request = {
  namespace: CancelReasonNamespace;
  resolve: (value: { reasonCode: string; reasonNote: string | null } | null) => void;
};

let host: ((request: Request) => void) | null = null;

export function askCancellationReason(namespace: CancelReasonNamespace) {
  return new Promise<{ reasonCode: string; reasonNote: string | null } | null>((resolve) => {
    if (!host) {
      resolve(null);
      return;
    }
    host({ namespace, resolve });
  });
}

const CODES: Record<CancelReasonNamespace, readonly string[]> = {
  taxiClient: [
    "driver_not_moving",
    "driver_too_late",
    "driver_concerning_behavior",
    "passenger_feels_unsafe",
    "pickup_location_problem",
    "other",
  ],
  taxiDriver: [
    "customer_not_responding",
    "unsafe_pickup_location",
    "intoxicated_or_threatening_customer",
    "vehicle_problem",
    "emergency_or_personal_issue",
    "other",
  ],
  deliveryClient: [
    "order_no_longer_needed",
    "delivery_too_long",
    "order_problem",
    "restaurant_or_seller_problem",
    "delivery_problem",
    "other",
  ],
  deliveryDriver: [
    "customer_not_responding",
    "delivery_location_problem",
    "safety_problem",
    "vehicle_problem",
    "emergency_or_personal_issue",
    "other",
  ],
  restaurant: [
    "cannot_prepare",
    "item_unavailable",
    "too_busy_or_closed",
    "safety_problem",
    "order_details_problem",
    "other",
  ],
  seller: [
    "cannot_fulfill",
    "item_unavailable",
    "seller_unavailable",
    "safety_problem",
    "order_problem",
    "other",
  ],
};

export function CancellationReasonHost() {
  const { t } = useTranslation();
  const [request, setRequest] = useState<Request | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    host = (next) => {
      setCode(null);
      setNote("");
      setRequest(next);
    };
    return () => {
      host = null;
    };
  }, []);

  function close(value: { reasonCode: string; reasonNote: string | null } | null) {
    request?.resolve(value);
    setRequest(null);
  }

  const trimmed = note.trim();
  const otherReady = code !== "other" || trimmed.length >= 8;
  const codes = request ? CODES[request.namespace] : [];

  return (
    <Modal visible={request != null} transparent animationType="fade" onRequestClose={() => close(null)}>
      <Pressable style={styles.backdrop} onPress={() => close(null)}>
        <Pressable style={styles.card} onPress={() => undefined}>
          <Text style={styles.title}>{t("cancellation.title", "Why are you cancelling?")}</Text>
          {codes.map((item) => (
            <TouchableOpacity key={item} style={styles.row} onPress={() => setCode(item)}>
              <Text style={[styles.rowText, code === item && styles.rowOn]}>
                {t(`cancellation.${request?.namespace}.${item}`)}
              </Text>
            </TouchableOpacity>
          ))}
          {code === "other" ? (
            <>
              <Text style={styles.label}>{t("cancellation.describe", "Describe your reason")}</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                style={styles.input}
                multiline
                maxLength={500}
              />
            </>
          ) : null}
          <TouchableOpacity
            disabled={!code || !otherReady}
            style={[styles.confirm, (!code || !otherReady) && styles.disabled]}
            onPress={() => {
              if (!code || !otherReady) return;
              close({ reasonCode: code, reasonNote: code === "other" ? trimmed : null });
            }}
          >
            <Text style={styles.confirmText}>{t("cancellation.confirm", "Confirm cancellation")}</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  card: {
    backgroundColor: "#0F172A",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    gap: 8,
  },
  title: { color: "#F8FAFC", fontWeight: "800", fontSize: 18, marginBottom: 6 },
  row: { paddingVertical: 8 },
  rowText: { color: "#E2E8F0", fontSize: 15 },
  rowOn: { color: "#FBBF24", fontWeight: "800" },
  label: { color: "#CBD5E1", marginTop: 8 },
  input: {
    minHeight: 72,
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    color: "#F8FAFC",
    padding: 10,
  },
  confirm: {
    marginTop: 8,
    backgroundColor: "#B45309",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  confirmText: { color: "#fff", fontWeight: "800" },
  disabled: { opacity: 0.4 },
});
