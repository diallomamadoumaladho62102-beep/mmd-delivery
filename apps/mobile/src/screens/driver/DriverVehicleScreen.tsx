import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/AppNavigator";
import ScreenHeader from "../../components/navigation/ScreenHeader";
import {
  addDriverVehicle,
  fetchDriverCapabilities,
  fetchDriverVehicleById,
  updateDriverCapabilities,
  updateDriverVehicleById,
  type VehicleCategoryStatus,
} from "../../lib/driverServicePreferencesApi";
import {
  deleteDriverVehiclePhotoFile,
  resolveVehiclePhotoPublicUrl,
  uploadDriverVehiclePhoto,
} from "../../lib/driverVehiclePhoto";
import { toUserFacingError } from "../../lib/userFacingError";

type Nav = NativeStackNavigationProp<RootStackParamList, "DriverVehicle">;
type Rt = RouteProp<RootStackParamList, "DriverVehicle">;

function statusColor(status: string) {
  if (status === "eligible") return "#15803d";
  if (status === "pending_review") return "#b45309";
  if (status === "expired_age" || status === "missing_documents") return "#b91c1c";
  return "#64748b";
}

export function DriverVehicleScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Rt>();
  const paramVehicleId = route.params?.vehicleId;
  const vehicleId =
    paramVehicleId && paramVehicleId !== "new" ? paramVehicleId : null;
  const isCreate = vehicleId === null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [categories, setCategories] = useState<VehicleCategoryStatus[]>([]);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [pendingLocalPhoto, setPendingLocalPhoto] = useState<string | null>(
    null,
  );
  const [form, setForm] = useState({
    vehicle_make: "",
    vehicle_model: "",
    vehicle_year: "",
    vehicle_color: "",
    license_plate: "",
    seats_count: "4",
    vehicle_type: "sedan",
    has_air_conditioning: false,
    wheelchair_accessible: false,
    fuel_type: "gasoline",
    nickname: "",
    child_seat_available: false,
    pets_allowed: false,
    large_luggage: false,
    phone_charger_available: false,
    quiet_vehicle: false,
    non_smoking: false,
  });

  const previewUri = useMemo(() => {
    if (pendingLocalPhoto) return pendingLocalPhoto;
    return resolveVehiclePhotoPublicUrl(photoUrl);
  }, [pendingLocalPhoto, photoUrl]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const capabilities = await fetchDriverCapabilities().catch(() => ({
        non_smoking: false,
      }));

      if (vehicleId) {
        const data = await fetchDriverVehicleById(vehicleId);
        setCategories(data.categories);
        const v = data.vehicle as Record<string, unknown> | null;
        if (v) {
          setPhotoUrl(
            String(v.photo_url ?? "").trim() ? String(v.photo_url) : null,
          );
          setForm({
            vehicle_make: String(v.vehicle_make ?? ""),
            vehicle_model: String(v.vehicle_model ?? ""),
            vehicle_year: v.vehicle_year != null ? String(v.vehicle_year) : "",
            vehicle_color: String(v.vehicle_color ?? ""),
            license_plate: String(v.license_plate ?? ""),
            seats_count: String(v.seats_count ?? 4),
            vehicle_type: String(v.vehicle_type ?? "sedan"),
            has_air_conditioning: Boolean(v.has_air_conditioning),
            wheelchair_accessible: Boolean(v.wheelchair_accessible),
            fuel_type: String(v.fuel_type ?? "gasoline"),
            nickname: String(v.nickname ?? ""),
            child_seat_available: Boolean(v.child_seat_available),
            pets_allowed: Boolean(v.pets_allowed),
            large_luggage: Boolean(v.large_luggage),
            phone_charger_available: Boolean(v.phone_charger_available),
            quiet_vehicle: Boolean(v.quiet_vehicle),
            non_smoking: capabilities.non_smoking,
          });
        } else {
          setForm((prev) => ({ ...prev, non_smoking: capabilities.non_smoking }));
        }
      } else {
        setCategories([]);
        setPhotoUrl(null);
        setPendingLocalPhoto(null);
        setForm((prev) => ({ ...prev, non_smoking: capabilities.non_smoking }));
      }
    } catch (error) {
      Alert.alert(
        "Erreur",
        toUserFacingError(
          error,
          "Impossible de charger les informations du véhicule.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    void load();
  }, [load]);

  const pickPhoto = (source: "camera" | "gallery") => {
    void (async () => {
      try {
        setUploadingPhoto(true);
        if (!vehicleId) {
          const picked = await (async () => {
            const ImagePicker = await import("expo-image-picker");
            if (source === "camera") {
              const p = await ImagePicker.requestCameraPermissionsAsync();
              if (!p.granted) {
                Alert.alert("Camera", "Allow camera access.");
                return null;
              }
              const r = await ImagePicker.launchCameraAsync({
                mediaTypes: ["images"],
                quality: 0.85,
                allowsEditing: true,
                aspect: [16, 10],
                exif: false,
              });
              return !r.canceled && r.assets?.[0]?.uri ? r.assets[0].uri : null;
            }
            const p = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!p.granted) {
              Alert.alert("Photos", "Allow photo library access.");
              return null;
            }
            const r = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              quality: 0.85,
              allowsEditing: true,
              aspect: [16, 10],
              exif: false,
            });
            return !r.canceled && r.assets?.[0]?.uri ? r.assets[0].uri : null;
          })();
          if (picked) setPendingLocalPhoto(picked);
          return;
        }

        const path = await uploadDriverVehiclePhoto({
          vehicleId,
          source,
          previousPath: photoUrl,
        });
        await updateDriverVehicleById(vehicleId, { photo_url: path });
        setPhotoUrl(path);
        setPendingLocalPhoto(null);
        Alert.alert("Vehicle photo", "Photo uploaded successfully.");
      } catch (error) {
        if (String((error as Error)?.message ?? "") === "photo_cancelled") return;
        Alert.alert(
          "Erreur",
          toUserFacingError(error, "Impossible d'envoyer la photo."),
        );
      } finally {
        setUploadingPhoto(false);
      }
    })();
  };

  const removePhoto = () => {
    Alert.alert("Remove photo", "Delete this vehicle photo?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            try {
              setUploadingPhoto(true);
              if (vehicleId && photoUrl) {
                await updateDriverVehicleById(vehicleId, { photo_url: null });
                await deleteDriverVehiclePhotoFile(photoUrl);
              }
              setPhotoUrl(null);
              setPendingLocalPhoto(null);
            } catch (error) {
              Alert.alert(
                "Erreur",
                toUserFacingError(error, "Impossible de supprimer la photo."),
              );
            } finally {
              setUploadingPhoto(false);
            }
          })();
        },
      },
    ]);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        vehicle_make: form.vehicle_make.trim(),
        vehicle_model: form.vehicle_model.trim(),
        vehicle_year: Number(form.vehicle_year) || null,
        vehicle_color: form.vehicle_color.trim(),
        license_plate: form.license_plate.trim(),
        seats_count: Number(form.seats_count) || 4,
        vehicle_type: form.vehicle_type.trim(),
        has_air_conditioning: form.has_air_conditioning,
        wheelchair_accessible: form.wheelchair_accessible,
        fuel_type: form.fuel_type,
        nickname: form.nickname.trim() || null,
        child_seat_available: form.child_seat_available,
        pets_allowed: form.pets_allowed,
        large_luggage: form.large_luggage,
        phone_charger_available: form.phone_charger_available,
        quiet_vehicle: form.quiet_vehicle,
      };

      await updateDriverCapabilities({ non_smoking: form.non_smoking });

      let savedId = vehicleId;
      if (vehicleId) {
        await updateDriverVehicleById(vehicleId, payload);
      } else {
        const created = await addDriverVehicle(payload);
        savedId = created.id;
      }

      if (pendingLocalPhoto && savedId) {
        const { uploadDriverVehiclePhotoFromUri } = await import(
          "../../lib/driverVehiclePhoto"
        );
        const path = await uploadDriverVehiclePhotoFromUri({
          vehicleId: savedId,
          localUri: pendingLocalPhoto,
          previousPath: photoUrl,
        });
        await updateDriverVehicleById(savedId, { photo_url: path });
        setPhotoUrl(path);
        setPendingLocalPhoto(null);
      }

      Alert.alert(
        "Véhicule",
        isCreate
          ? "Véhicule ajouté. Il est en attente de validation par l'équipe MMD."
          : "Informations enregistrées. Si des champs importants ont changé, le véhicule repasse en validation admin.",
      );
      navigation.goBack();
    } catch (error) {
      Alert.alert(
        "Erreur",
        toUserFacingError(
          error,
          "Impossible d'enregistrer le véhicule pour le moment.",
        ),
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
        <ScreenHeader
          title="Véhicule"
          variant="light"
          fallbackRoute="DriverVehicles"
        />
        <ActivityIndicator style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
      <ScreenHeader
        title={isCreate ? "Ajouter un véhicule" : "Véhicule"}
        subtitle="Les catégories taxi sont calculées par le serveur. Vous ne pouvez pas vous auto-attribuer Comfort, XL ou Wheelchair."
        variant="light"
        fallbackRoute="DriverVehicles"
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.photoCard}>
          <Text style={styles.photoTitle}>Vehicle photo</Text>
          <Text style={styles.photoHelp}>
            Upload a clear photo of the vehicle used for trips.
          </Text>
          <View style={styles.photoPreview}>
            {previewUri ? (
              <Image
                source={{ uri: previewUri }}
                style={styles.photoImage}
                resizeMode="cover"
                accessibilityLabel="Vehicle photo preview"
              />
            ) : (
              <View style={styles.photoPlaceholder}>
                <Ionicons name="car-sport-outline" size={42} color="#94A3B8" />
                <Text style={styles.photoPlaceholderText}>No photo yet</Text>
              </View>
            )}
            {uploadingPhoto ? (
              <View style={styles.photoBusy}>
                <ActivityIndicator color="#FFF" />
              </View>
            ) : null}
          </View>
          <View style={styles.photoActions}>
            <TouchableOpacity
              style={styles.photoBtn}
              onPress={() => pickPhoto("camera")}
              disabled={uploadingPhoto || saving}
            >
              <Text style={styles.photoBtnText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.photoBtn}
              onPress={() => pickPhoto("gallery")}
              disabled={uploadingPhoto || saving}
            >
              <Text style={styles.photoBtnText}>Gallery</Text>
            </TouchableOpacity>
            {previewUri ? (
              <TouchableOpacity
                style={[styles.photoBtn, styles.photoBtnDanger]}
                onPress={removePhoto}
                disabled={uploadingPhoto || saving}
              >
                <Text style={styles.photoBtnText}>Remove</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {[
          ["vehicle_make", "Marque"],
          ["vehicle_model", "Modèle"],
          ["vehicle_year", "Année"],
          ["vehicle_color", "Couleur"],
          ["license_plate", "Plaque"],
          ["seats_count", "Places passagers"],
          ["vehicle_type", "Type (sedan, suv, van, minivan)"],
          [
            "fuel_type",
            "Motorisation (gasoline, diesel, hybrid, electric, plug_in_hybrid)",
          ],
          ["nickname", "Surnom (optionnel)"],
        ].map(([key, label]) => (
          <View key={key}>
            <Text style={styles.fieldLabel}>{label}</Text>
            <TextInput
              style={styles.input}
              value={(form as Record<string, string | boolean>)[key] as string}
              onChangeText={(text) =>
                setForm((prev) => ({ ...prev, [key]: text }))
              }
            />
          </View>
        ))}

        <View style={styles.row}>
          <Text style={styles.fieldLabel}>Climatisation</Text>
          <Switch
            value={form.has_air_conditioning}
            onValueChange={(v) =>
              setForm((prev) => ({ ...prev, has_air_conditioning: v }))
            }
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.fieldLabel}>Accessible fauteuil roulant</Text>
          <Switch
            value={form.wheelchair_accessible}
            onValueChange={(v) =>
              setForm((prev) => ({ ...prev, wheelchair_accessible: v }))
            }
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.fieldLabel}>Siège enfant</Text>
          <Switch
            value={form.child_seat_available}
            onValueChange={(v) =>
              setForm((prev) => ({ ...prev, child_seat_available: v }))
            }
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.fieldLabel}>Animaux acceptés</Text>
          <Switch
            value={form.pets_allowed}
            onValueChange={(v) =>
              setForm((prev) => ({ ...prev, pets_allowed: v }))
            }
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.fieldLabel}>Gros bagages</Text>
          <Switch
            value={form.large_luggage}
            onValueChange={(v) =>
              setForm((prev) => ({ ...prev, large_luggage: v }))
            }
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.fieldLabel}>Chargeur téléphone</Text>
          <Switch
            value={form.phone_charger_available}
            onValueChange={(v) =>
              setForm((prev) => ({ ...prev, phone_charger_available: v }))
            }
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.fieldLabel}>Véhicule silencieux</Text>
          <Switch
            value={form.quiet_vehicle}
            onValueChange={(v) =>
              setForm((prev) => ({ ...prev, quiet_vehicle: v }))
            }
          />
        </View>
        <View style={styles.row}>
          <Text style={styles.fieldLabel}>Non-fumeur</Text>
          <Switch
            value={form.non_smoking}
            onValueChange={(v) =>
              setForm((prev) => ({ ...prev, non_smoking: v }))
            }
          />
        </View>

        {categories.length > 0 ? (
          <View style={{ marginTop: 8, gap: 6 }}>
            <Text style={styles.fieldLabel}>Catégories taxi (serveur)</Text>
            {categories.map((c) => (
              <Text key={c.category} style={{ color: statusColor(c.status) }}>
                {c.category}: {c.status}
              </Text>
            ))}
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => void save()}
          disabled={saving || uploadingPhoto}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.saveText}>
              {isCreate ? "Ajouter" : "Enregistrer"}
            </Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  fieldLabel: { color: "#334155", fontWeight: "700", marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    color: "#0F172A",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 4,
  },
  saveBtn: {
    marginTop: 12,
    backgroundColor: "#0F172A",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  saveText: { color: "#fff", fontWeight: "800" },
  photoCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: 14,
    gap: 10,
  },
  photoTitle: { color: "#0F172A", fontWeight: "800", fontSize: 16 },
  photoHelp: { color: "#64748B", fontSize: 13, lineHeight: 18 },
  photoPreview: {
    height: 160,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#F1F5F9",
  },
  photoImage: { width: "100%", height: "100%" },
  photoPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  photoPlaceholderText: { color: "#94A3B8", fontWeight: "600" },
  photoBusy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  photoBtn: {
    backgroundColor: "#0F172A",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  photoBtnDanger: { backgroundColor: "#B91C1C" },
  photoBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
});

export default DriverVehicleScreen;
