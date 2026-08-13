import React, { useCallback, useEffect, useState } from "react";
import { toUserFacingError } from "../../lib/userFacingError";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StatusBar,
  ScrollView,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  addTaxiFavoriteDriver,
  fetchTaxiFavoriteDrivers,
  removeTaxiFavoriteDriver,
} from "../../lib/taxiClientApi";
import {
  MMD_BLUE,
  MMD_CARD_ON_BLUE_STRONG,
  MMD_FONT,
  MMD_GREEN,
  MMD_STROKE,
  MMD_TEXT,
  MMD_TEXT_MUTED_BLUE,
  MMD_WHITE,
} from "../../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList, "TaxiFavorites">;

type FavoriteRow = {
  id: string;
  driver_user_id: string;
  created_at: string;
};

export default function TaxiFavoritesScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();
  const [favorites, setFavorites] = useState<FavoriteRow[]>([]);
  const [driverId, setDriverId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchTaxiFavoriteDrivers();
      setFavorites((res?.favorites as FavoriteRow[]) ?? []);
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.favorites.title", "Favorite drivers"),
        toUserFacingError(e, t("taxi.favorites.loadFailed", "Load failed"))
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAdd() {
    const id = driverId.trim();
    if (!id) return;
    setSaving(true);
    try {
      await addTaxiFavoriteDriver(id);
      setDriverId("");
      await load();
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.favorites.title", "Favorite drivers"),
        toUserFacingError(e, t("taxi.favorites.addFailed", "Add failed"))
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(id: string) {
    setSaving(true);
    try {
      await removeTaxiFavoriteDriver(id);
      await load();
    } catch (e: unknown) {
      Alert.alert(
        t("taxi.favorites.title", "Favorite drivers"),
        toUserFacingError(e, t("taxi.favorites.removeFailed", "Remove failed"))
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={t("taxi.favorites.title", "Favorite drivers")}
        fallbackRoute="ClientHome"
        variant="dark"
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <TextInput
          value={driverId}
          onChangeText={setDriverId}
          placeholder={t("taxi.favorites.driverId", "Driver user ID")}
          placeholderTextColor={MMD_TEXT_MUTED_BLUE}
          style={styles.input}
        />

        <TouchableOpacity
          onPress={handleAdd}
          disabled={saving}
          style={styles.cta}
          activeOpacity={0.85}
        >
          <Text style={styles.ctaText}>
            {saving
              ? t("taxi.favorites.saving", "Saving…")
              : t("taxi.favorites.add", "Add favorite")}
          </Text>
        </TouchableOpacity>

        {loading ? <ActivityIndicator color={MMD_GREEN} /> : null}

        {favorites.map((row) => (
          <View key={row.id} style={styles.row}>
            <Text style={styles.rowId}>{row.driver_user_id}</Text>
            <TouchableOpacity onPress={() => handleRemove(row.driver_user_id)}>
              <Text style={styles.remove}>
                {t("taxi.favorites.remove", "Remove")}
              </Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: MMD_BLUE },
  scroll: { padding: 20, gap: 14 },
  input: {
    height: 42,
    borderWidth: 1,
    borderColor: MMD_STROKE,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    fontSize: 14,
  },
  cta: {
    backgroundColor: MMD_GREEN,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: "center",
  },
  ctaText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.extrabold,
    fontSize: 15,
    fontWeight: "800",
  },
  row: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: MMD_STROKE,
    backgroundColor: MMD_CARD_ON_BLUE_STRONG,
    gap: 8,
  },
  rowId: {
    color: "#E2E8F0",
    fontFamily: MMD_FONT.bold,
    fontSize: 15,
    fontWeight: "700",
  },
  remove: {
    color: "#FCA5A5",
    fontFamily: MMD_FONT.semibold,
    fontSize: 14,
    fontWeight: "600",
  },
});
