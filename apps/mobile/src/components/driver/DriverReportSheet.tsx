import React from "react";
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from "react-native";
import {
  DRIVER_MAP_REPORT_CATEGORIES,
  DRIVER_MAP_REPORT_LABELS,
  type DriverMapReportCategory,
} from "../../lib/driverNavigation/reports/config";

type Props = {
  visible: boolean;
  submitting: boolean;
  onClose: () => void;
  onSelectCategory: (category: DriverMapReportCategory) => void;
};

export function DriverReportSheet({
  visible,
  submitting,
  onClose,
  onSelectCategory,
}: Props) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        style={{
          flex: 1,
          backgroundColor: "rgba(2,6,23,0.72)",
          justifyContent: "flex-end",
        }}
        onPress={onClose}
      >
        <Pressable
          style={{
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            backgroundColor: "#0F172A",
            paddingHorizontal: 18,
            paddingTop: 16,
            paddingBottom: 28,
            borderWidth: 1,
            borderColor: "rgba(148,163,184,0.18)",
          }}
          onPress={(event) => event.stopPropagation()}
        >
          <View
            style={{
              width: 42,
              height: 4,
              borderRadius: 999,
              backgroundColor: "rgba(148,163,184,0.35)",
              alignSelf: "center",
              marginBottom: 14,
            }}
          />

          <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "900" }}>
            Signaler un problème
          </Text>
          <Text style={{ color: "#94A3B8", fontSize: 12, marginTop: 6, lineHeight: 18 }}>
            Le signalement sera visible aux autres chauffeurs pendant 25 minutes à proximité.
          </Text>

          {submitting && (
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 12 }}>
              <ActivityIndicator size="small" color="#93C5FD" />
              <Text style={{ color: "#CBD5E1", marginLeft: 8, fontSize: 12, fontWeight: "700" }}>
                Envoi en cours…
              </Text>
            </View>
          )}

          <ScrollView
            style={{ maxHeight: 360, marginTop: 16 }}
            contentContainerStyle={{ paddingBottom: 8 }}
          >
            {DRIVER_MAP_REPORT_CATEGORIES.map((category) => (
              <TouchableOpacity
                key={category}
                disabled={submitting}
                activeOpacity={0.86}
                onPress={() => onSelectCategory(category)}
                style={{
                  borderRadius: 16,
                  paddingVertical: 14,
                  paddingHorizontal: 14,
                  marginBottom: 8,
                  backgroundColor: "rgba(15,23,42,0.95)",
                  borderWidth: 1,
                  borderColor: "rgba(96,165,250,0.18)",
                  opacity: submitting ? 0.6 : 1,
                }}
              >
                <Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "800" }}>
                  {DRIVER_MAP_REPORT_LABELS[category]}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <TouchableOpacity
            onPress={onClose}
            disabled={submitting}
            activeOpacity={0.86}
            style={{
              marginTop: 8,
              borderRadius: 999,
              paddingVertical: 13,
              alignItems: "center",
              backgroundColor: "rgba(51,65,85,0.85)",
            }}
          >
            <Text style={{ color: "#E2E8F0", fontSize: 14, fontWeight: "800" }}>
              Annuler
            </Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
