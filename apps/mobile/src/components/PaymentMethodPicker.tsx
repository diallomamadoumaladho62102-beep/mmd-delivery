import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { useTranslation } from "react-i18next";
import type { PaymentMethodOption } from "../lib/paymentMethodsApi";

type Props = {
  visible: boolean;
  title?: string;
  methods: PaymentMethodOption[];
  loading?: boolean;
  onClose: () => void;
  onSelect: (method: PaymentMethodOption) => void;
};

export function PaymentMethodPicker({
  visible,
  title,
  methods,
  loading = false,
  onClose,
  onSelect,
}: Props) {
  const { t } = useTranslation();
  const heading = title ?? t("payments.picker.title");
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{heading}</Text>
          {loading ? (
            <ActivityIndicator size="large" color="#111827" style={styles.loader} />
          ) : methods.length === 0 ? (
            <Text style={styles.empty}>
              {t("payments.picker.unavailable")}
            </Text>
          ) : (
            methods.map((method) => (
              <TouchableOpacity
                key={method.method_code}
                style={[
                  styles.option,
                  !method.available && styles.optionDisabled,
                ]}
                disabled={!method.available}
                onPress={() => onSelect(method)}
              >
                <View style={styles.optionHeader}>
                  <Text style={styles.optionTitle}>{method.display_name}</Text>
                  {method.test_mode ? (
                    <View style={styles.testBadge}>
                      <Text style={styles.testBadgeText}>{t("payments.picker.test")}</Text>
                    </View>
                  ) : null}
                </View>
                {method.description ? (
                  <Text style={styles.optionDescription}>{method.description}</Text>
                ) : null}
                {!method.available ? (
                  <Text style={styles.unavailable}>
                    {method.unavailable_reason ?? t("payments.picker.unavailable")}
                  </Text>
                ) : null}
              </TouchableOpacity>
            ))
          )}
          <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
            <Text style={styles.cancelText}>{t("common.cancel")}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#fff",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 28,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 16,
  },
  loader: {
    marginVertical: 24,
  },
  empty: {
    color: "#6B7280",
    fontSize: 15,
    marginBottom: 16,
  },
  option: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    backgroundColor: "#F9FAFB",
  },
  optionDisabled: {
    opacity: 0.75,
    backgroundColor: "#F3F4F6",
  },
  optionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
    flexShrink: 1,
  },
  testBadge: {
    backgroundColor: "#FEF3C7",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  testBadgeText: {
    color: "#92400E",
    fontSize: 11,
    fontWeight: "700",
  },
  optionDescription: {
    marginTop: 4,
    fontSize: 13,
    color: "#4B5563",
  },
  unavailable: {
    marginTop: 6,
    fontSize: 12,
    color: "#B45309",
  },
  cancelButton: {
    marginTop: 8,
    alignItems: "center",
    paddingVertical: 12,
  },
  cancelText: {
    color: "#6B7280",
    fontSize: 15,
    fontWeight: "600",
  },
});
