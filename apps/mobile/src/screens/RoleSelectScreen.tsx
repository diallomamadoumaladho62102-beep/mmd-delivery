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
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/AppNavigator";

import { supabase } from "../lib/supabase";
import { clearSelectedRole, setSelectedRole } from "../lib/authRole";
import { useTranslation } from "react-i18next";
import {
  MMD_BLUE,
  MMD_BLUE_SOFT,
  MMD_FONT,
  MMD_GOLD,
  MMD_GOLD_BORDER,
  MMD_GOLD_BORDER_SOFT,
  MMD_GOLD_DARK,
  MMD_TEXT,
  MMD_WHITE,
  mmdLogoSize,
} from "../theme/mmdUi";

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

type RoleCardConfig = {
  role: PublicRole;
  title: string;
  subtitle: string;
  iconBg: string;
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
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={pressIn}
        onPressOut={pressOut}
        accessibilityRole="button"
        accessibilityLabel={config.title}
        style={[styles.roleCard, compact && styles.roleCardCompact]}
      >
        <View style={[styles.roleIconCircle, { backgroundColor: config.iconBg }]}>
          {config.icon}
        </View>
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
        <Ionicons
          name="chevron-forward"
          size={compact ? 18 : 20}
          color={MMD_GOLD_DARK}
        />
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
    const horizontalPad = tablet ? 28 : tiny ? 14 : compact ? 16 : 20;
    const logoSize = mmdLogoSize(width, height);
    return {
      compact,
      tiny,
      tablet,
      horizontalPad,
      logoSize,
      titleSize: tiny ? 28 : compact ? 32 : tablet ? 40 : 36,
      panelTitleSize: tiny ? 26 : compact ? 28 : 32,
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
          key: "support",
          icon: "headset" as const,
          label: t("roleSelect.advantages.support", "24/7 Support"),
        },
        {
          key: "tracking",
          icon: "location" as const,
          label: t("roleSelect.advantages.tracking", "Live Tracking"),
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
        iconBg: "#3366FF",
        icon: <Ionicons name="person" size={22} color={MMD_WHITE} />,
      },
      {
        role: "driver",
        title: t("roleSelect.roles.driver", "Driver"),
        subtitle: t(
          "roleSelect.roleSubtitles.driver",
          "Drive, deliver and earn with us",
        ),
        iconBg: "#33CC33",
        icon: (
          <MaterialCommunityIcons name="steering" size={24} color={MMD_WHITE} />
        ),
      },
      {
        role: "restaurant",
        title: t("roleSelect.roles.restaurant", "Restaurant"),
        subtitle: t(
          "roleSelect.roleSubtitles.restaurant",
          "Manage your restaurant",
        ),
        iconBg: "#FFB200",
        icon: <Ionicons name="restaurant" size={22} color={MMD_WHITE} />,
      },
      {
        role: "seller",
        title: t("roleSelect.roles.seller", "Marketplace Seller"),
        subtitle: t(
          "roleSelect.roleSubtitles.seller",
          "Sell and grow your business",
        ),
        iconBg: "#E52626",
        icon: <Ionicons name="storefront" size={22} color={MMD_WHITE} />,
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
      <StatusBar barStyle="light-content" backgroundColor={MMD_BLUE} />
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.scrollContent,
            {
              paddingHorizontal: layout.horizontalPad,
              paddingTop: layout.tiny ? 8 : 16,
              paddingBottom: layout.tiny ? 16 : 24,
              maxWidth: layout.tablet ? 560 : undefined,
              alignSelf: "center",
              width: "100%",
            },
          ]}
          showsVerticalScrollIndicator={false}
          bounces
          keyboardShouldPersistTaps="handled"
        >
          <FadeIn delay={40} style={styles.brandBlock}>
            <Image
              source={require("../../assets/brand/mmd-logo-ui.png")}
              style={{
                width: layout.logoSize,
                height: layout.logoSize,
                borderRadius: layout.logoSize / 2,
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
                  lineHeight: layout.titleSize + 4,
                },
              ]}
            >
              MMD Delivery
            </Text>
            <Text
              style={[
                styles.taglineGold,
                layout.compact && { fontSize: 18 },
                layout.tiny && { fontSize: 16 },
              ]}
            >
              {t("roleSelect.taglineHeart", "We deliver with heart")}
            </Text>
            <Text
              style={[
                styles.taglineModes,
                layout.compact && { fontSize: 17 },
                layout.tiny && { fontSize: 15 },
              ]}
            >
              {t("roleSelect.taglineModes", "Taxi • Delivery • Business")}
            </Text>
            <Text
              style={[
                styles.taglineMuted,
                layout.compact && { fontSize: 15 },
                layout.tiny && { fontSize: 14 },
              ]}
            >
              {t("roleSelect.taglineFast", "Fast, simple and reliable")}
            </Text>
          </FadeIn>

          <FadeIn delay={200} style={styles.panelWrap}>
            <View style={styles.panelBorder}>
              <View
                style={[
                  styles.panelInner,
                  {
                    padding: layout.tiny ? 14 : 20,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.panelTitle,
                    { fontSize: layout.panelTitleSize },
                  ]}
                >
                  {t("roleSelect.title", "Choose your mode")}
                </Text>
                <Text
                  style={[
                    styles.panelSubtitle,
                    layout.compact && { fontSize: 14, marginBottom: 10 },
                  ]}
                >
                  {t(
                    "roleSelect.subtitle",
                    "Select a role to access the corresponding interface.",
                  )}
                </Text>

                <View style={styles.rolesStack}>
                  {roleCards.map((card, index) => (
                    <FadeIn key={card.role} delay={280 + index * 60}>
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
            </View>
          </FadeIn>

          <FadeIn delay={520} style={styles.advantagesRow}>
            {advantages.map((item) => (
              <View key={item.key} style={styles.advantageItem}>
                <View
                  style={[
                    styles.advantageIconWrap,
                    layout.tiny && { width: 36, height: 36 },
                  ]}
                >
                  <Ionicons
                    name={item.icon}
                    size={layout.tiny ? 16 : 20}
                    color={MMD_GOLD_DARK}
                  />
                </View>
                <Text
                  style={[
                    styles.advantageLabel,
                    layout.compact && { fontSize: 10 },
                  ]}
                  numberOfLines={2}
                >
                  {item.label}
                </Text>
              </View>
            ))}
          </FadeIn>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: MMD_BLUE,
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
  brandBlock: {
    alignItems: "center",
    justifyContent: "center",
    height: 163,
    marginBottom: 4,
  },
  titleBlock: {
    alignItems: "center",
    marginBottom: 12,
    paddingHorizontal: 8,
    gap: 8,
  },
  appTitle: {
    color: MMD_GOLD,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    textAlign: "center",
  },
  taglineGold: {
    color: MMD_GOLD,
    fontSize: 22,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    textAlign: "center",
  },
  taglineModes: {
    color: MMD_WHITE,
    fontSize: 20,
    fontFamily: MMD_FONT.bold,
    fontWeight: "700",
    textAlign: "center",
  },
  taglineMuted: {
    color: MMD_WHITE,
    fontSize: 18,
    fontFamily: MMD_FONT.regular,
    fontWeight: "400",
    textAlign: "center",
  },
  panelWrap: {
    marginBottom: 12,
  },
  panelBorder: {
    borderWidth: 1,
    borderColor: MMD_GOLD_BORDER,
    borderRadius: 24,
    padding: 1.5,
  },
  panelInner: {
    backgroundColor: MMD_BLUE_SOFT,
    borderWidth: 1,
    borderColor: MMD_GOLD_BORDER_SOFT,
    borderRadius: 22.5,
    overflow: "hidden",
  },
  panelTitle: {
    color: MMD_GOLD,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    textAlign: "center",
    marginBottom: 8,
  },
  panelSubtitle: {
    color: MMD_TEXT,
    fontSize: 15,
    fontFamily: MMD_FONT.regular,
    fontWeight: "400",
    textAlign: "center",
    lineHeight: 20,
    marginBottom: 12,
    paddingHorizontal: 4,
  },
  rolesStack: {
    gap: 12,
    paddingTop: 10,
  },
  roleCard: {
    minHeight: 79,
    borderRadius: 22,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: MMD_BLUE,
    borderWidth: 1.5,
    borderColor: MMD_GOLD_DARK,
  },
  roleCardCompact: {
    minHeight: 72,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 12,
    gap: 10,
  },
  roleIconCircle: {
    width: 50,
    height: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: MMD_GOLD_DARK,
    alignItems: "center",
    justifyContent: "center",
  },
  roleTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  roleTitle: {
    color: MMD_GOLD_DARK,
    fontSize: 17,
    fontFamily: MMD_FONT.extrabold,
    fontWeight: "800",
    marginBottom: 2,
  },
  roleTitleCompact: {
    fontSize: 15,
  },
  roleSubtitle: {
    color: MMD_TEXT,
    fontSize: 16,
    fontFamily: MMD_FONT.regular,
    fontWeight: "400",
    lineHeight: 16,
  },
  roleSubtitleCompact: {
    fontSize: 13,
    lineHeight: 15,
  },
  advantagesRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: MMD_GOLD_BORDER_SOFT,
    gap: 6,
  },
  advantageItem: {
    flex: 1,
    alignItems: "center",
    minWidth: 0,
  },
  advantageIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
    backgroundColor: "rgba(245,197,66,0.08)",
    borderWidth: 1,
    borderColor: MMD_GOLD_BORDER_SOFT,
  },
  advantageLabel: {
    color: MMD_GOLD_DARK,
    fontSize: 11,
    fontFamily: MMD_FONT.semibold,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 14,
  },
});
