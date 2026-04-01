import React, { useState } from "react";
import { ScrollView, View, Text, TextInput, Switch, Button, Alert } from "react-native";
import { supabase } from "../../lib/supabase";
import { useTranslation } from "react-i18next";

type Props = { navigation: any };

export default function RestaurantSetupScreen({ navigation }: Props) {
  const { t } = useTranslation();

  const [restaurantName, setRestaurantName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [cuisineType, setCuisineType] = useState("");
  const [description, setDescription] = useState("");

  const [offersDelivery, setOffersDelivery] = useState(true);
  const [offersPickup, setOffersPickup] = useState(true);
  const [offersDineIn, setOffersDineIn] = useState(false);

  const onSave = async () => {
    const {
      data: { user },
      error: uerr,
    } = await supabase.auth.getUser();

    if (uerr) return Alert.alert(t("restaurant.setup.alerts.errorTitle", "Erreur"), uerr.message);

    if (!user) {
      return Alert.alert(
        t("restaurant.setup.alerts.errorTitle", "Erreur"),
        t("restaurant.setup.alerts.notLoggedIn", "Pas connecté")
      );
    }

    const payload = {
      user_id: user.id,
      email: user.email,
      restaurant_name: restaurantName.trim(),
      phone: phone.trim(),
      address: address.trim(),
      city: city.trim(),
      postal_code: postalCode.trim(),
      cuisine_type: cuisineType.trim(),
      description: description.trim() || null,
      opening_hours: null, // we will add later
      offers_delivery: offersDelivery,
      offers_pickup: offersPickup,
      offers_dine_in: offersDineIn,
      status: "pending" as const, // ✅ respects DB constraint
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase
      .from("restaurant_profiles")
      .upsert(payload, { onConflict: "user_id" });

    if (error) {
      console.log(error.message, error.details, error.hint);
      return Alert.alert(t("restaurant.setup.alerts.errorTitle", "Erreur"), error.message);
    }

    Alert.alert(
      t("restaurant.setup.alerts.successTitle", "OK"),
      t("restaurant.setup.alerts.successBody", "Profil envoyé. En attente d'approbation admin.")
    );

    // ✅ Like web: after setup -> go back through gate
    navigation.replace("RestaurantGate");
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>
        {t("restaurant.setup.title", "Profil restaurant")}
      </Text>

      <Text>{t("restaurant.setup.fields.restaurantName", "Nom du restaurant")}</Text>
      <TextInput
        value={restaurantName}
        onChangeText={setRestaurantName}
        style={{ borderWidth: 1, padding: 10 }}
      />

      <Text>{t("restaurant.setup.fields.phone", "Téléphone")}</Text>
      <TextInput value={phone} onChangeText={setPhone} style={{ borderWidth: 1, padding: 10 }} />

      <Text>{t("restaurant.setup.fields.address", "Adresse")}</Text>
      <TextInput value={address} onChangeText={setAddress} style={{ borderWidth: 1, padding: 10 }} />

      <Text>{t("restaurant.setup.fields.city", "Ville")}</Text>
      <TextInput value={city} onChangeText={setCity} style={{ borderWidth: 1, padding: 10 }} />

      <Text>{t("restaurant.setup.fields.postalCode", "Code postal")}</Text>
      <TextInput
        value={postalCode}
        onChangeText={setPostalCode}
        style={{ borderWidth: 1, padding: 10 }}
      />

      <Text>{t("restaurant.setup.fields.cuisineType", "Type de cuisine")}</Text>
      <TextInput
        value={cuisineType}
        onChangeText={setCuisineType}
        style={{ borderWidth: 1, padding: 10 }}
      />

      <Text>{t("restaurant.setup.fields.description", "Description")}</Text>
      <TextInput
        value={description}
        onChangeText={setDescription}
        style={{ borderWidth: 1, padding: 10 }}
      />

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text>{t("restaurant.setup.options.delivery", "Livraison")}</Text>
        <Switch value={offersDelivery} onValueChange={setOffersDelivery} />
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text>{t("restaurant.setup.options.pickup", "À emporter")}</Text>
        <Switch value={offersPickup} onValueChange={setOffersPickup} />
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Text>{t("restaurant.setup.options.dineIn", "Sur place")}</Text>
        <Switch value={offersDineIn} onValueChange={setOffersDineIn} />
      </View>

      <Button
        title={t("restaurant.setup.actions.save", "Enregistrer mon profil restaurant")}
        onPress={onSave}
      />
    </ScrollView>
  );
}
