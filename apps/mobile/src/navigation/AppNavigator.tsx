import * as React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";

import { HomeScreen } from "../screens/HomeScreen";
import { RoleSelectScreen } from "../screens/RoleSelectScreen";
import { ClientHomeScreen } from "../screens/ClientHomeScreen";
import { DriverHomeScreen } from "../screens/DriverHomeScreen";
import { RestaurantHomeScreen } from "../screens/RestaurantHomeScreen";
import { DriverOrderDetailsScreen } from "../screens/DriverOrderDetailsScreen";

// 👇 commandes restaurant
import { RestaurantOrdersScreen } from "../screens/RestaurantOrdersScreen";

// 👇 nouvelle commande client
import { ClientNewOrderScreen } from "../screens/ClientNewOrderScreen";

// 👇 écran de connexion client (auth Supabase)
import { ClientAuthScreen } from "../screens/ClientAuthScreen";

export type RootStackParamList = {
  ClientAuth: undefined;            // 👈 nouvel écran auth client
  Home: undefined;
  RoleSelect: undefined;
  ClientHome: undefined;
  ClientNewOrder: undefined;        // 👈 nouvel écran client
  DriverHome: undefined;
  RestaurantHome: undefined;
  RestaurantOrders: undefined;      // 👈 écran commandes restaurant
  DriverOrderDetails: { orderId: string };
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="ClientAuth"   // 👈 on commence par l’authentification
        screenOptions={{
          headerShown: false,
        }}
      >
        {/* AUTH CLIENT */}
        <Stack.Screen name="ClientAuth" component={ClientAuthScreen} />

        {/* HOME + CHOIX DE RÔLE */}
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="RoleSelect" component={RoleSelectScreen} />

        {/* CLIENT */}
        <Stack.Screen name="ClientHome" component={ClientHomeScreen} />
        <Stack.Screen
          name="ClientNewOrder"
          component={ClientNewOrderScreen}
        />

        {/* DRIVER */}
        <Stack.Screen name="DriverHome" component={DriverHomeScreen} />
        <Stack.Screen
          name="DriverOrderDetails"
          component={DriverOrderDetailsScreen}
        />

        {/* RESTAURANT */}
        <Stack.Screen
          name="RestaurantHome"
          component={RestaurantHomeScreen}
        />
        <Stack.Screen
          name="RestaurantOrders"
          component={RestaurantOrdersScreen}
          options={{ headerShown: true, title: "Commandes restaurant" }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
