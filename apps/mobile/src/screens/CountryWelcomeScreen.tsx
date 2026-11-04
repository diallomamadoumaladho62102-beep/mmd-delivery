import React, { useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";

import type { RootStackParamList } from "../navigation/AppNavigator";
import {
  marketCurrency,
  marketPhonePrefix,
  type MarketCountry,
} from "../lib/selectedMarket";
import { writeManualClientScope } from "../lib/clientScopeStorage";
import { saveSelectedMarket } from "../lib/selectedMarketStore";
import { supabase } from "../lib/supabase";
import { LOCALE_USER_SET_KEY, setGlobalLocale } from "../i18n/storage";
import { setAppLocale } from "../i18n";
import { MMD_BLUE, MMD_WHITE, mmdLogoSize } from "../theme/mmdUi";

type Nav = NativeStackNavigationProp<RootStackParamList, "CountryWelcome">;
type WelcomeRoute = RouteProp<RootStackParamList, "CountryWelcome">;

export function CountryWelcomeScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const route = useRoute<WelcomeRoute>();
  const { width, height } = useWindowDimensions();
  const options: Array<{
    code: MarketCountry;
    flag: string;
    title: string;
    detail: string;
  }> = [
    {
      code: "GN",
      flag: "🇬🇳",
      title: t("guineaMarket.countryOption", {
        name: t("guineaMarket.guineaName"),
        dial: marketPhonePrefix("GN"),
        currency: marketCurrency("GN"),
      }),
      detail: t("guineaMarket.guineaCoverage"),
    },
    {
      code: "US",
      flag: "🇺🇸",
      title: t("guineaMarket.countryOption", {
        name: t("guineaMarket.usName"),
        dial: marketPhonePrefix("US"),
        currency: marketCurrency("US"),
      }),
      detail: t("guineaMarket.usCoverage"),
    },
  ];
  const [selected, setSelected] = useState<MarketCountry | null>(null);
  const [saving, setSaving] = useState(false);
  const logo = mmdLogoSize(width, height);

  async function continueWithCountry() {
    if (!selected || saving) return;
    setSaving(true);
    try {
      await saveSelectedMarket(selected);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const uid = sessionData.session?.user?.id;
        if (uid) {
          await writeManualClientScope(
            { countryCode: selected, stateCode: null, setAt: Date.now() },
            uid,
          );
        }
      } catch {
        // Selected market still drives scope via AsyncStorage.
      }
      const userChoseLanguage = await AsyncStorage.getItem(LOCALE_USER_SET_KEY);
      if (userChoseLanguage !== "true") {
        const locale = selected === "GN" ? "fr" : "en";
        await setGlobalLocale(locale);
        await setAppLocale(locale);
      }
      if (route.params?.returnTo) {
        navigation.goBack();
        return;
      }
      navigation.replace("RoleSelect");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.body}>
        <Image
          source={require("../../assets/brand/mmd-logo-ui.png")}
          style={{ width: logo, height: logo }}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        <Text style={styles.title}>{t("guineaMarket.welcomeTitle")}</Text>
        <Text style={styles.subtitle}>{t("guineaMarket.welcomeSubtitle")}</Text>

        <View style={styles.options}>
          {options.map((option) => {
            const active = selected === option.code;
            return (
              <Pressable
                key={option.code}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setSelected(option.code)}
                style={[styles.option, active && styles.optionSelected]}
              >
                <Text style={styles.flag}>{option.flag}</Text>
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>{option.title}</Text>
                  <Text style={styles.optionDetail}>{option.detail}</Text>
                </View>
                <View style={[styles.radio, active && styles.radioOn]}>
                  {active ? <View style={styles.radioDot} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !selected || saving }}
        disabled={!selected || saving}
        onPress={() => void continueWithCountry()}
        style={[styles.continue, (!selected || saving) && styles.continueDisabled]}
      >
        {saving ? (
          <ActivityIndicator color={MMD_WHITE} />
        ) : (
          <Text style={styles.continueLabel}>{t("guineaMarket.authContinue")}</Text>
        )}
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F4F7FB",
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    marginTop: 18,
    color: "#0F172A",
    fontSize: 28,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    marginTop: 8,
    color: "#475569",
    fontSize: 16,
    textAlign: "center",
  },
  options: {
    alignSelf: "stretch",
    marginTop: 28,
    gap: 12,
  },
  option: {
    minHeight: 76,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "#D6DEEA",
    backgroundColor: MMD_WHITE,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  optionSelected: {
    borderColor: MMD_BLUE,
    backgroundColor: "#E8F0FF",
  },
  flag: {
    fontSize: 32,
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    color: "#0F172A",
    fontSize: 18,
    fontWeight: "700",
  },
  optionDetail: {
    marginTop: 2,
    color: "#334155",
    fontSize: 15,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: "#94A3B8",
    alignItems: "center",
    justifyContent: "center",
  },
  radioOn: {
    borderColor: MMD_BLUE,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: MMD_BLUE,
  },
  continue: {
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: MMD_BLUE,
    alignItems: "center",
    justifyContent: "center",
  },
  continueDisabled: {
    backgroundColor: "#94A3B8",
  },
  continueLabel: {
    color: MMD_WHITE,
    fontSize: 17,
    fontWeight: "800",
  },
});
