import React, { useEffect, useMemo, useRef } from "react";
import {
  Alert,
  Animated,
  Easing,
  Image,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

import { supabase } from "../lib/supabase";
import { clearSelectedRole, setSelectedRole } from "../lib/authRole";
import { useTranslation } from "react-i18next";

type RoleSelectNav = NativeStackNavigationProp<RootStackParamList, "RoleSelect">;

type PublicRole = "client" | "driver" | "restaurant" | "seller";
type ProfileRole = PublicRole | "admin" | null;
type DriverStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "incomplete"
  | "suspended"
  | null;

const GOLD = "#F5C542";
const GOLD_SOFT = "#E8C547";
const BG = "#000000";

type RoleCardConfig = {
  role: PublicRole;
  title: string;
  subtitle: string;
  colors: [string, string, string];
  glow: string;
  icon: React.ReactNode;
};

function normalizeProfileRole(value: unknown): ProfileRole {
  const role = String(value ?? "").trim().toLowerCase();

  if (role === "client") return "client";
  if (role === "driver" || role === "livreur" || role === "chauffeur") {
    return "driver";
  }
  if (role === "restaurant") return "restaurant";
  if (
    role === "admin" ||
    role === "super_admin" ||
    role === "founder" ||
    role === "support" ||
    role === "support_admin" ||
    role === "ops" ||
    role === "operations_admin" ||
    role === "finance" ||
    role === "finance_admin" ||
    role === "review" ||
    role === "review_admin"
  ) {
    return "admin";
  }

  return null;
}

function normalizeDriverStatus(value: unknown): DriverStatus {
  const status = String(value ?? "").trim().toLowerCase();

  if (
    status === "pending" ||
    status === "approved" ||
    status === "rejected" ||
    status === "incomplete" ||
    status === "suspended"
  ) {
    return status;
  }

  return null;
}

function FadeIn({
  delay,
  children,
  style,
}: {
  delay: number;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 520,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 520,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, opacity, translateY]);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}

function PremiumRoleCard({
  config,
  onPress,
  compact,
}: {
  config: RoleCardConfig;
  onPress: () => void;
  compact: boolean;
}) {
  const scale = useRef(new Animated.Value(1)).current;

  const pressIn = () => {
    Animated.spring(scale, {
      toValue: 0.975,
      friction: 7,
      tension: 160,
      useNativeDriver: true,
    }).start();
  };

  const pressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 6,
      tension: 140,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View
      style={[
        styles.roleCardShell,
        compact && styles.roleCardShellCompact,
        {
          transform: [{ scale }],
          shadowColor: config.glow,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        accessibilityRole="button"
        accessibilityLabel={config.title}
        style={styles.roleCardPressable}
      >
        <LinearGradient
          colors={config.colors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.roleCard, compact && styles.roleCardCompact]}
        >
          <View style={styles.roleIconCircle}>{config.icon}</View>
          <View style={styles.roleTextBlock}>
            <Text style={[styles.roleTitle, compact && styles.roleTitleCompact]}>
              {config.title}
            </Text>
            <Text
              style={[styles.roleSubtitle, compact && styles.roleSubtitleCompact]}
              numberOfLines={2}
            >
              {config.subtitle}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={compact ? 18 : 20} color="#FFFFFF" />
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

export function RoleSelectScreen() {
  const navigation = useNavigation<RoleSelectNav>();
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();

  const layout = useMemo(() => {
    const compact = height < 740 || width < 360;
    const tiny = height < 680 || width < 340;
    const tablet = width >= 768;
    const contentWidth = Math.min(width, tablet ? 520 : width);
    const horizontalPad = tablet ? 28 : tiny ? 14 : compact ? 16 : 20;
    const logoWidth = tiny
      ? Math.min(140, contentWidth * 0.42)
      : compact
        ? Math.min(160, contentWidth * 0.44)
        : tablet
          ? 236
          : Math.min(214, contentWidth * 0.56);
    const logoHeight = logoWidth * (615 / 960);
    return {
      compact,
      tiny,
      tablet,
      contentWidth,
      horizontalPad,
      logoWidth,
      logoHeight,
      titleSize: tiny ? 26 : compact ? 30 : tablet ? 40 : 36,
      panelRadius: tiny ? 24 : compact ? 28 : 34,
    };
  }, [height, width]);

  const advantages = useMemo(
    () =>
      [
        {
          key: "secure",
          icon: "shield-checkmark" as const,
          label: t("roleSelect.advantages.secure", "Secure Payments"),
        },
        {
          key: "fast",
          icon: "flash" as const,
          label: t("roleSelect.advantages.fast", "Fast Delivery"),
        },
        {
          key: "tracking",
          icon: "location" as const,
          label: t("roleSelect.advantages.tracking", "Live Tracking"),
        },
        {
          key: "support",
          icon: "headset" as const,
          label: t("roleSelect.advantages.support", "24/7 Support"),
        },
      ] as const,
    [t],
  );

  const roleCards: RoleCardConfig[] = useMemo(
    () => [
      {
        role: "client",
        title: t("roleSelect.roles.client", "Client"),
        subtitle: t(
          "roleSelect.roleSubtitles.client",
          "Order a taxi, delivery or anything",
        ),
        colors: ["#F04444", "#C81E1E", "#8B1010"],
        glow: "#EF4444",
        icon: <Ionicons name="person" size={18} color="#FFFFFF" />,
      },
      {
        role: "driver",
        title: t("roleSelect.roles.driver", "Driver"),
        subtitle: t(
          "roleSelect.roleSubtitles.driver",
          "Drive, deliver and earn with us",
        ),
        colors: ["#2F80ED", "#1B5FBF", "#0F3F8A"],
        glow: "#3B82F6",
        icon: (
          <MaterialCommunityIcons name="steering" size={20} color="#FFFFFF" />
        ),
      },
      {
        role: "restaurant",
        title: t("roleSelect.roles.restaurant", "Restaurant"),
        subtitle: t(
          "roleSelect.roleSubtitles.restaurant",
          "Manage your restaurant",
        ),
        colors: ["#2FBF6B", "#1B8F4A", "#0F5F30"],
        glow: "#22C55E",
        icon: <Ionicons name="restaurant" size={18} color="#FFFFFF" />,
      },
      {
        role: "seller",
        title: t("roleSelect.roles.seller", "Marketplace Seller"),
        subtitle: t(
          "roleSelect.roleSubtitles.seller",
          "Sell and grow your business",
        ),
        colors: ["#8B5CF6", "#6D28D9", "#4C1D95"],
        glow: "#8B5CF6",
        icon: <Ionicons name="storefront" size={18} color="#FFFFFF" />,
      },
    ],
    [t],
  );

  async function routeLoggedInUser(selectedRole: PublicRole, userId: string) {
    if (selectedRole === "seller") {
      navigation.navigate("SellerGate");
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("role, is_founder")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.log("RoleSelect profile check error:", profileError);
      Alert.alert(
        t("common.error", "Erreur"),
        t(
          "roleSelect.errors.profileCheckFailed",
          "Impossible de vérifier ton profil. Réessaie.",
        ),
      );
      return;
    }

    const realRole = normalizeProfileRole((profile as any)?.role);
    const isFounder = (profile as any)?.is_founder === true;
    const canUseAnyPublicRole = isFounder || realRole === "admin";

    if (realRole && realRole !== selectedRole && !canUseAnyPublicRole) {
      Alert.alert(
        t("roleSelect.wrongRoleTitle", "Compte déjà connecté"),
        t(
          "roleSelect.wrongRoleBody",
          "Ce compte est enregistré comme {{role}}. Déconnecte-toi si tu veux utiliser un autre rôle.",
          { role: realRole },
        ),
      );

      if (realRole === "client") {
        navigation.navigate("ClientHome");
        return;
      }

      if (realRole === "driver") {
        const { data: driverProfile } = await supabase
          .from("driver_profiles")
          .select("status")
          .eq("user_id", userId)
          .maybeSingle();

        const status = normalizeDriverStatus((driverProfile as any)?.status);

        if (status === "approved") {
          navigation.navigate("DriverTabs");
          return;
        }

        navigation.navigate("DriverOnboarding");
        return;
      }

      if (realRole === "restaurant") {
        navigation.navigate("RestaurantGate");
        return;
      }

      return;
    }

    const roleToUse = canUseAnyPublicRole
      ? selectedRole
      : (realRole ?? selectedRole);

    if (roleToUse === "client") {
      navigation.navigate("ClientHome");
      return;
    }

    if (roleToUse === "driver") {
      const { data: driverProfile, error: driverError } = await supabase
        .from("driver_profiles")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle();

      if (driverError) {
        console.log("RoleSelect driver profile check error:", driverError);
        navigation.navigate("DriverOnboarding");
        return;
      }

      const status = normalizeDriverStatus((driverProfile as any)?.status);

      if (status === "approved") {
        navigation.navigate("DriverTabs");
        return;
      }

      if (status === "suspended") {
        Alert.alert(
          t("roleSelect.driverSuspendedTitle", "Compte suspendu"),
          t(
            "roleSelect.driverSuspendedBody",
            "Ton compte chauffeur est suspendu. Contacte le support MMD Delivery.",
          ),
        );
        await clearSelectedRole();
        await supabase.auth.signOut();
        navigation.navigate("RoleSelect");
        return;
      }

      navigation.navigate("DriverOnboarding");
      return;
    }

    if (roleToUse === "restaurant") {
      navigation.navigate("RestaurantGate");
      return;
    }

    Alert.alert(
      t("roleSelect.adminTitle", "Admin"),
      t(
        "roleSelect.adminBody",
        "Ce compte est un compte admin. Utilise l’interface admin prévue pour gérer MMD Delivery.",
      ),
    );
  }

  async function handlePress(role: PublicRole) {
    try {
      await setSelectedRole(role);

      const { data, error } = await supabase.auth.getSession();

      if (error) {
        console.log("RoleSelect session error:", error);
      }

      const session = data.session ?? null;

      if (!session?.user?.id) {
        if (role === "client") {
          navigation.navigate("ClientAuth");
          return;
        }

        if (role === "driver") {
          navigation.navigate("DriverAuth");
          return;
        }

        if (role === "restaurant") {
          navigation.navigate("RestaurantAuth");
          return;
        }

        navigation.navigate("ClientAuth");
        return;
      }

      await routeLoggedInUser(role, session.user.id);
    } catch (e: any) {
      console.log("RoleSelect handlePress error:", e);

      Alert.alert(
        t("common.error", "Erreur"),
        e?.message ??
          t(
            "roleSelect.errors.openRoleFailed",
            "Impossible d’ouvrir ce rôle pour le moment.",
          ),
      );
    }
  }

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <LinearGradient
        colors={["#0A0000", "#000000", "#050208", "#000000"]}
        locations={[0, 0.28, 0.62, 1]}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.ambianceLayer}>
        <LinearGradient
          colors={["rgba(220,38,38,0.22)", "rgba(220,38,38,0)", "transparent"]}
          start={{ x: 0.1, y: 0 }}
          end={{ x: 0.9, y: 1 }}
          style={styles.glowLeft}
        />
        <LinearGradient
          colors={["rgba(245,197,66,0.12)", "transparent"]}
          start={{ x: 1, y: 0 }}
          end={{ x: 0.2, y: 0.8 }}
          style={styles.glowRight}
        />
        <LinearGradient
          colors={["transparent", "rgba(127,29,29,0.18)", "transparent"]}
          start={{ x: 0, y: 0.2 }}
          end={{ x: 1, y: 0.55 }}
          style={styles.glowWave}
        />
      </View>

      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingHorizontal: layout.horizontalPad,
              paddingTop: layout.tiny ? 4 : layout.compact ? 8 : 16,
              paddingBottom: layout.tiny ? 12 : layout.compact ? 16 : 24,
              maxWidth: layout.tablet ? 560 : undefined,
              alignSelf: "center",
              width: "100%",
            },
          ]}
          showsVerticalScrollIndicator={false}
          bounces
        >
          <FadeIn delay={40} style={styles.brandBlock}>
            <View
              style={[
                styles.logoGlow,
                {
                  width: layout.logoWidth + 36,
                  height: layout.logoHeight + 36,
                },
              ]}
            />
            <Image
              source={require("../../assets/brand/mmd-logo-ui.png")}
              style={{
                width: layout.logoWidth,
                height: layout.logoHeight,
              }}
              resizeMode="contain"
              accessibilityLabel="MMD Delivery"
            />
          </FadeIn>

          <FadeIn delay={120} style={styles.titleBlock}>
            <Text
              style={[
                styles.appTitle,
                {
                  fontSize: layout.titleSize,
                  lineHeight: layout.titleSize + 6,
                },
              ]}
            >
              MMD Delivery
            </Text>
            <Text
              style={[
                styles.taglineGold,
                layout.compact && styles.taglineGoldCompact,
                layout.tiny && { fontSize: 13, marginBottom: 5 },
              ]}
            >
              {t("roleSelect.taglineHeart", "We deliver with heart ❤️")}
            </Text>
            <Text
              style={[
                styles.taglineModes,
                layout.compact && styles.taglineModesCompact,
                layout.tiny && { fontSize: 13, marginBottom: 5 },
              ]}
            >
              {t("roleSelect.taglineModes", "Taxi • Delivery • Business")}
            </Text>
            <Text
              style={[
                styles.taglineMuted,
                layout.compact && styles.taglineMutedCompact,
                layout.tiny && { fontSize: 12 },
              ]}
            >
              {t("roleSelect.taglineFast", "Fast, simple and reliable 🚀")}
            </Text>
          </FadeIn>

          <FadeIn
            delay={200}
            style={[styles.advantagesRow, layout.tiny && { marginBottom: 12 }]}
          >
            {advantages.map((item) => (
              <View key={item.key} style={styles.advantageItem}>
                <View
                  style={[
                    styles.advantageIconWrap,
                    layout.tiny && { width: 30, height: 30, marginBottom: 4 },
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={layout.tiny ? 16 : layout.compact ? 18 : 20}
                    color={GOLD}
                  />
                </View>
                <Text
                  style={[
                    styles.advantageLabel,
                    layout.compact && styles.advantageLabelCompact,
                  ]}
                  numberOfLines={2}
                >
                  {item.label}
                </Text>
              </View>
            ))}
          </FadeIn>

          <FadeIn delay={280} style={styles.panelWrap}>
            <LinearGradient
              colors={[
                "rgba(220,38,38,0.55)",
                "rgba(148,163,184,0.18)",
                "rgba(148,163,184,0.08)",
              ]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={[
                styles.panelBorder,
                { borderRadius: layout.panelRadius },
              ]}
            >
              <View
                style={[
                  styles.panelInner,
                  {
                    borderRadius: layout.panelRadius - 1.5,
                    padding: layout.tiny ? 12 : layout.compact ? 16 : 20,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.panelTitle,
                    layout.compact && styles.panelTitleCompact,
                  ]}
                >
                  {t("roleSelect.title", "Choose your mode")}
                </Text>
                <Text
                  style={[
                    styles.panelSubtitle,
                    layout.compact && styles.panelSubtitleCompact,
                  ]}
                >
                  {t(
                    "roleSelect.subtitle",
                    "Select a role to access the corresponding interface.",
                  )}
                </Text>

                <View style={styles.rolesStack}>
                  {roleCards.map((card, index) => (
                    <FadeIn key={card.role} delay={340 + index * 70}>
                      <PremiumRoleCard
                        config={card}
                        compact={layout.compact || layout.tiny}
                        onPress={() => {
                          void handlePress(card.role);
                        }}
                      />
                    </FadeIn>
                  ))}
                </View>
              </View>
            </LinearGradient>
          </FadeIn>

          <FadeIn delay={620} style={styles.footer}>
            <View style={styles.footerItem}>
              <Ionicons name="shield-checkmark" size={14} color={GOLD_SOFT} />
              <Text style={styles.footerText}>
                {t("roleSelect.footer.safe", "Your data is safe with us")}
              </Text>
            </View>
            <View style={styles.footerDivider} />
            <View style={styles.footerItem}>
              <Ionicons name="lock-closed" size={13} color={GOLD_SOFT} />
              <Text style={styles.footerText}>
                {t("roleSelect.footer.trusted", "Trusted by thousands")}
              </Text>
            </View>
          </FadeIn>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  safe: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  ambianceLayer: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  glowLeft: {
    position: "absolute",
    top: -40,
    left: -60,
    width: 280,
    height: 320,
    borderRadius: 200,
  },
  glowRight: {
    position: "absolute",
    top: 40,
    right: -80,
    width: 260,
    height: 280,
    borderRadius: 200,
  },
  glowWave: {
    position: "absolute",
    top: "18%",
    left: -20,
    right: -20,
    height: 180,
  },
  brandBlock: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  logoGlow: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "rgba(245,197,66,0.10)",
    shadowColor: "#F5C542",
    shadowOpacity: 0.55,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  titleBlock: {
    alignItems: "center",
    marginBottom: 18,
    paddingHorizontal: 8,
  },
  appTitle: {
    color: "#FFFFFF",
    fontWeight: "800",
    letterSpacing: 0.2,
    textAlign: "center",
    marginBottom: 10,
  },
  taglineGold: {
    color: GOLD_SOFT,
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
    marginBottom: 7,
  },
  taglineGoldCompact: {
    fontSize: 14,
  },
  taglineModes: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: 0.3,
    marginBottom: 7,
  },
  taglineModesCompact: {
    fontSize: 14,
  },
  taglineMuted: {
    color: "#A8B3C7",
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
  },
  taglineMutedCompact: {
    fontSize: 13,
  },
  advantagesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
    gap: 6,
  },
  advantageItem: {
    flex: 1,
    alignItems: "center",
    minWidth: 0,
  },
  advantageIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
    backgroundColor: "rgba(245,197,66,0.08)",
  },
  advantageLabel: {
    color: "#F8FAFC",
    fontSize: 10,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 13,
  },
  advantageLabelCompact: {
    fontSize: 9,
    lineHeight: 12,
  },
  panelWrap: {
    marginBottom: 18,
  },
  panelBorder: {
    padding: 1.5,
  },
  panelInner: {
    backgroundColor: "rgba(12, 14, 22, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.10)",
    overflow: "hidden",
  },
  panelTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  panelTitleCompact: {
    fontSize: 21,
  },
  panelSubtitle: {
    color: "#94A3B8",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 19,
    marginBottom: 18,
    paddingHorizontal: 4,
  },
  panelSubtitleCompact: {
    fontSize: 12,
    marginBottom: 14,
  },
  rolesStack: {
    gap: 12,
  },
  roleCardShell: {
    borderRadius: 22,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  roleCardShellCompact: {
    borderRadius: 18,
  },
  roleCardPressable: {
    borderRadius: 22,
    overflow: "hidden",
  },
  roleCard: {
    minHeight: 72,
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  roleCardCompact: {
    minHeight: 64,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 10,
  },
  roleIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  roleTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  roleTitle: {
    color: "#FFFFFF",
    fontSize: 17,
    fontWeight: "800",
    marginBottom: 2,
  },
  roleTitleCompact: {
    fontSize: 15,
  },
  roleSubtitle: {
    color: "rgba(255,255,255,0.82)",
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
  },
  roleSubtitleCompact: {
    fontSize: 11,
    lineHeight: 15,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingHorizontal: 4,
    paddingTop: 2,
  },
  footerItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
  },
  footerDivider: {
    width: StyleSheet.hairlineWidth,
    height: 18,
    backgroundColor: "rgba(148,163,184,0.45)",
  },
  footerText: {
    color: "#94A3B8",
    fontSize: 11,
    fontWeight: "500",
    flexShrink: 1,
  },
});
