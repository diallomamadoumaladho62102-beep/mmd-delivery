/**
 * Driver Vehicle — Figma Lot 6
 * (311:6614 Loading, 311:6625 Mode Picker, 311:6642 Bicycle, 311:6655 Edit).
 * Logic/APIs unchanged; visual tokens from mmdUi.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StatusBar,
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
import { DriverBrandLoadingState } from "../../components/driver/DriverBrandLoadingState";
import {
  addDriverVehicle,
  changeDriverTransportMode,
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
import {
  MMD_ACTION_NAVY,
  MMD_BLUE,
  MMD_FONT,
  MMD_GOLD_CLASSIC,
  MMD_GLASS,
  MMD_TAXI_GREEN,
  MMD_WHITE,
} from "../../theme/mmdUi";

const MMD_LOGO = require("../../../assets/brand/mmd-logo-ui.png");

type Nav = NativeStackNavigationProp<RootStackParamList, "DriverVehicle">;
type Rt = RouteProp<RootStackParamList, "DriverVehicle">;
type TransportMode = "car" | "moto" | "bike";

function statusColor(status: string) {
  if (status === "eligible") return MMD_TAXI_GREEN;
  if (status === "pending_review") return "#F59E0B";
  if (status === "expired_age" || status === "missing_documents") return "#EF4444";
  return "rgba(255,255,255,0.5)";
}

function BrandFooter({ compact }: { compact?: boolean }) {
  return (
    <View style={[styles.brandFooter, compact && styles.brandFooterCompact]}>
      <Image
        source={MMD_LOGO}
        style={[styles.brandLogo, compact && styles.brandLogoCompact]}
        resizeMode="contain"
        accessibilityLabel="MMD Delivery"
      />
      <Text style={[styles.brandLabel, compact && styles.brandLabelCompact]}>
        MMD Delivery
      </Text>
    </View>
  );
}

function AmenityToggle(props: {
  emoji: string;
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <View style={styles.toggleRow}>
      <Text style={styles.toggleEmoji}>{props.emoji}</Text>
      <Text style={styles.toggleLabel}>{props.label}</Text>
      <Switch
        value={props.value}
        onValueChange={props.onValueChange}
        trackColor={{ false: "rgba(255,255,255,0.25)", true: MMD_TAXI_GREEN }}
        thumbColor={MMD_WHITE}
        ios_backgroundColor="rgba(255,255,255,0.25)"
      />
    </View>
  );
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
  /** Create flow: must choose Car / Motorcycle / Bicycle before the form. */
  const [transportMode, setTransportMode] = useState<TransportMode | null>(
    isCreate ? null : "car",
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
    if (isCreate && !transportMode) {
      Alert.alert(
        "Type de véhicule",
        "Choisissez d'abord Car, Motorcycle ou Bicycle.",
      );
      return;
    }

    setSaving(true);
    try {
      if (isCreate && transportMode === "bike") {
        await changeDriverTransportMode("bike");
        Alert.alert(
          "Mode vélo",
          "Votre catégorie est passée en Bicycle. Aucun véhicule motorisé n'est requis pour passer en ligne.",
        );
        navigation.goBack();
        return;
      }

      if (isCreate && (transportMode === "car" || transportMode === "moto")) {
        await changeDriverTransportMode(transportMode);
      }

      const payload: Record<string, unknown> = {
        vehicle_make: form.vehicle_make.trim(),
        vehicle_model: form.vehicle_model.trim(),
        vehicle_year: Number(form.vehicle_year) || null,
        vehicle_color: form.vehicle_color.trim(),
        license_plate: form.license_plate.trim(),
        seats_count:
          transportMode === "moto"
            ? Math.min(Number(form.seats_count) || 2, 2)
            : Number(form.seats_count) || 4,
        vehicle_type:
          transportMode === "moto"
            ? "motorcycle"
            : form.vehicle_type.trim() || "sedan",
        has_air_conditioning:
          transportMode === "moto" ? false : form.has_air_conditioning,
        wheelchair_accessible:
          transportMode === "moto" ? false : form.wheelchair_accessible,
        fuel_type: form.fuel_type,
        nickname: form.nickname.trim() || null,
        child_seat_available:
          transportMode === "moto" ? false : form.child_seat_available,
        pets_allowed: form.pets_allowed,
        large_luggage: transportMode === "moto" ? false : form.large_luggage,
        phone_charger_available: form.phone_charger_available,
        quiet_vehicle: form.quiet_vehicle,
      };

      if (!payload.vehicle_make || !payload.vehicle_model || !payload.license_plate) {
        Alert.alert(
          "Formulaire incomplet",
          "Marque, modèle et plaque sont obligatoires.",
        );
        return;
      }

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
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <ScreenHeader
          title="Vehicle"
          subtitle="Vehicle details"
          variant="dark"
          fallbackRoute="DriverVehicles"
        />
        <DriverBrandLoadingState title="Loading vehicle..." logoAtBottom />
      </SafeAreaView>
    );
  }

  if (isCreate && transportMode === null) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <ScreenHeader
          title="Add a vehicle"
          subtitle="Choose the type first"
          variant="dark"
          fallbackRoute="DriverVehicles"
        />
        <View style={styles.modePicker}>
          {(
            [
              {
                id: "car" as const,
                emoji: "🚗",
                label: "Car",
                hint: "Car - food, parcels, taxi",
              },
              {
                id: "moto" as const,
                emoji: "🏍️",
                label: "Motorcycle",
                hint: "Motorcycle - fast delivery",
              },
              {
                id: "bike" as const,
                emoji: "🚲",
                label: "Bicycle",
                hint: "Bicycle - no motorized fleet required",
              },
            ] as const
          ).map((opt) => (
            <TouchableOpacity
              key={opt.id}
              style={styles.modeCard}
              activeOpacity={0.9}
              onPress={() => {
                setTransportMode(opt.id);
                if (opt.id === "moto") {
                  setForm((prev) => ({
                    ...prev,
                    seats_count: "2",
                    vehicle_type: "motorcycle",
                    has_air_conditioning: false,
                    wheelchair_accessible: false,
                    child_seat_available: false,
                    large_luggage: false,
                  }));
                } else if (opt.id === "car") {
                  setForm((prev) => ({
                    ...prev,
                    seats_count: "4",
                    vehicle_type: "sedan",
                  }));
                }
              }}
            >
              <Text style={styles.modeEmoji}>{opt.emoji}</Text>
              <View style={styles.modeText}>
                <Text style={styles.modeLabel}>{opt.label}</Text>
                <Text style={styles.modeHint}>{opt.hint}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={MMD_WHITE} />
            </TouchableOpacity>
          ))}
          <Text style={styles.modeInfo}>Category is synced automatically</Text>
          <BrandFooter />
        </View>
      </SafeAreaView>
    );
  }

  if (isCreate && transportMode === "bike") {
    return (
      <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
        <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
        <ScreenHeader
          title="Bicycle"
          subtitle="No motorized vehicle required"
          variant="dark"
          fallbackRoute="DriverVehicles"
        />
        <View style={styles.bikeBody}>
          <TouchableOpacity
            style={styles.bikeCard}
            onPress={() => setTransportMode(null)}
            activeOpacity={0.9}
          >
            <Text style={styles.bikeEmoji}>🚲</Text>
            <Text style={styles.modeLabel}>Change type</Text>
            <Text style={[styles.modeHint, styles.bikeHintCentered]}>
              Back to Car / Motorcycle / Bicycle selection
            </Text>
          </TouchableOpacity>

          <View style={styles.bikeActions}>
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={() => void save()}
              disabled={saving}
              activeOpacity={0.9}
            >
              {saving ? (
                <ActivityIndicator color={MMD_WHITE} />
              ) : (
                <Text style={styles.saveText}>Confirm bicycle mode</Text>
              )}
            </TouchableOpacity>
            <Text style={styles.bikeHint}>Confirm to sync with dispatch</Text>
          </View>

          <BrandFooter />
        </View>
      </SafeAreaView>
    );
  }

  const motoForm = transportMode === "moto";
  const fieldRows: Array<[string, string]> = [
    ["vehicle_make", "Make"],
    ["vehicle_model", "Model"],
    ["vehicle_year", "Year"],
    ["vehicle_color", "Color"],
    ["license_plate", "Plate"],
    ...(motoForm
      ? []
      : ([
          ["seats_count", "Passenger seats"],
          ["vehicle_type", "Type (sedan, suv, van, minivan)"],
        ] as Array<[string, string]>)),
    [
      "fuel_type",
      "Motorisation (gasoline, diesel, hybrid, electric, plug_in_hybrid)",
    ],
    ["nickname", "Nickname (optional)"],
  ];

  return (
    <SafeAreaView style={styles.container} edges={["bottom", "left", "right"]}>
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <ScreenHeader
        title={isCreate ? "Add a vehicle" : "Vehicle"}
        subtitle={
          isCreate
            ? `Type: ${transportMode === "moto" ? "Motorcycle" : "Car"}. Taxi categories are calculated by the server.`
            : "Taxi categories are calculated by the server."
        }
        variant="dark"
        fallbackRoute="DriverVehicles"
      />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {isCreate ? (
          <TouchableOpacity onPress={() => setTransportMode(null)}>
            <Text style={styles.changeType}>Change vehicle type</Text>
          </TouchableOpacity>
        ) : null}

        <View style={styles.photoCard}>
          <Text style={styles.photoTitle}>Vehicle photo</Text>
          <Text style={styles.photoHelp}>
            Upload a clear photo of the vehicle
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
                <Text style={styles.photoPlaceholderEmoji}>📸</Text>
                <Text style={styles.photoPlaceholderText}>No photo yet</Text>
              </View>
            )}
            {uploadingPhoto ? (
              <View style={styles.photoBusy}>
                <ActivityIndicator color={MMD_WHITE} />
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

        <View style={styles.fieldsCard}>
          {fieldRows.map(([key, label]) => (
            <View key={key} style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>{label}</Text>
              <TextInput
                style={styles.input}
                value={(form as Record<string, string | boolean>)[key] as string}
                onChangeText={(text) =>
                  setForm((prev) => ({ ...prev, [key]: text }))
                }
                placeholderTextColor="rgba(255,255,255,0.35)"
                placeholder="—"
              />
            </View>
          ))}
        </View>

        <View style={styles.togglesCard}>
          {!motoForm ? (
            <>
              <AmenityToggle
                emoji="❄️"
                label="Air conditioning"
                value={form.has_air_conditioning}
                onValueChange={(v) =>
                  setForm((prev) => ({ ...prev, has_air_conditioning: v }))
                }
              />
              <AmenityToggle
                emoji="♿"
                label="Accessible"
                value={form.wheelchair_accessible}
                onValueChange={(v) =>
                  setForm((prev) => ({ ...prev, wheelchair_accessible: v }))
                }
              />
              <AmenityToggle
                emoji="👶"
                label="Baby seat"
                value={form.child_seat_available}
                onValueChange={(v) =>
                  setForm((prev) => ({ ...prev, child_seat_available: v }))
                }
              />
              <AmenityToggle
                emoji="🧳"
                label="Large luggage"
                value={form.large_luggage}
                onValueChange={(v) =>
                  setForm((prev) => ({ ...prev, large_luggage: v }))
                }
              />
            </>
          ) : null}
          <AmenityToggle
            emoji="🐾"
            label="Pets"
            value={form.pets_allowed}
            onValueChange={(v) =>
              setForm((prev) => ({ ...prev, pets_allowed: v }))
            }
          />
          <AmenityToggle
            emoji="🔌"
            label="Phone charger"
            value={form.phone_charger_available}
            onValueChange={(v) =>
              setForm((prev) => ({ ...prev, phone_charger_available: v }))
            }
          />
          <AmenityToggle
            emoji="🔇"
            label="Quiet vehicle"
            value={form.quiet_vehicle}
            onValueChange={(v) =>
              setForm((prev) => ({ ...prev, quiet_vehicle: v }))
            }
          />
          <AmenityToggle
            emoji="🚭"
            label="Non-smoking"
            value={form.non_smoking}
            onValueChange={(v) =>
              setForm((prev) => ({ ...prev, non_smoking: v }))
            }
          />
        </View>

        {categories.length > 0 ? (
          <View style={styles.categoriesCard}>
            <Text style={styles.categoriesTitle}>Taxi categories (server)</Text>
            {categories.map((c) => (
              <View key={c.category} style={styles.categoryRow}>
                <View
                  style={[
                    styles.categoryDot,
                    { backgroundColor: statusColor(c.status) },
                  ]}
                />
                <Text style={styles.categoryText}>
                  {c.category}: {c.status}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <TouchableOpacity
          style={styles.saveBtn}
          onPress={() => void save()}
          disabled={saving || uploadingPhoto}
          activeOpacity={0.9}
        >
          {saving ? (
            <ActivityIndicator color={MMD_WHITE} />
          ) : (
            <Text style={styles.saveText}>
              {isCreate ? "Add" : "Save"}
            </Text>
          )}
        </TouchableOpacity>

        <BrandFooter compact />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: MMD_BLUE },
  content: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 32,
    gap: 8,
  },
  modePicker: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
    gap: 12,
  },
  modeCard: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 16,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  modeEmoji: { fontSize: 28, lineHeight: 34 },
  modeText: { flex: 1, gap: 4 },
  modeLabel: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 16,
  },
  modeHint: {
    color: "rgba(255,255,255,0.5)",
    fontFamily: MMD_FONT.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  modeInfo: {
    marginTop: 24,
    textAlign: "center",
    color: "rgba(255,255,255,0.4)",
    fontFamily: MMD_FONT.regular,
    fontSize: 12,
  },
  bikeBody: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 32,
    gap: 32,
    alignItems: "center",
  },
  bikeCard: {
    width: "100%",
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 16,
    padding: 24,
    gap: 12,
    alignItems: "center",
  },
  bikeEmoji: { fontSize: 48, lineHeight: 56 },
  bikeActions: { width: "100%", gap: 16, alignItems: "center" },
  bikeHint: {
    color: "rgba(255,255,255,0.25)",
    fontFamily: MMD_FONT.regular,
    fontSize: 12,
    textAlign: "center",
  },
  bikeHintCentered: { textAlign: "center" },
  changeType: {
    color: MMD_TAXI_GREEN,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    marginBottom: 4,
  },
  photoCard: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 6,
  },
  photoTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 11,
  },
  photoHelp: {
    color: "rgba(255,255,255,0.5)",
    fontFamily: MMD_FONT.regular,
    fontSize: 11,
    lineHeight: 14,
  },
  photoPreview: {
    minHeight: 80,
    borderRadius: 10,
    overflow: "hidden",
    backgroundColor: MMD_GLASS,
  },
  photoImage: { width: "100%", height: 120 },
  photoPlaceholder: {
    minHeight: 80,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 12,
  },
  photoPlaceholderEmoji: { fontSize: 18 },
  photoPlaceholderText: {
    color: "rgba(255,255,255,0.6)",
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 11,
  },
  photoBusy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  photoActions: { flexDirection: "row", gap: 6, flexWrap: "wrap" },
  photoBtn: {
    flex: 1,
    minWidth: 80,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderRadius: 8,
    minHeight: 28,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  photoBtnDanger: { backgroundColor: "rgba(185,28,28,0.55)" },
  photoBtnText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 11,
  },
  fieldsCard: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    gap: 0,
  },
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  fieldLabel: {
    color: "rgba(255,255,255,0.5)",
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 11,
    flexShrink: 1,
    maxWidth: "48%",
  },
  input: {
    flex: 1,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 12,
    textAlign: "right",
    paddingVertical: 2,
    minWidth: 80,
  },
  togglesCard: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  toggleEmoji: { fontSize: 11, lineHeight: 16 },
  toggleLabel: {
    flex: 1,
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 10,
  },
  categoriesCard: {
    backgroundColor: MMD_ACTION_NAVY,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  categoriesTitle: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    fontSize: 10,
  },
  categoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  categoryDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  categoryText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.regular,
    fontSize: 12,
  },
  saveBtn: {
    backgroundColor: MMD_TAXI_GREEN,
    borderRadius: 12,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    width: "100%",
  },
  saveText: {
    color: MMD_WHITE,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    fontSize: 14,
  },
  brandFooter: {
    marginTop: "auto",
    paddingTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  brandFooterCompact: {
    justifyContent: "flex-start",
    gap: 6,
    paddingTop: 8,
    paddingBottom: 4,
  },
  brandLogo: { width: 40, height: 40, borderRadius: 12 },
  brandLogoCompact: { width: 32, height: 32 },
  brandLabel: {
    color: MMD_GOLD_CLASSIC,
    fontSize: 14,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
  },
  brandLabelCompact: { fontSize: 11 },
});

export default DriverVehicleScreen;
