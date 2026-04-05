je vois ça dedans import React from "react";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { HomeScreen } from "../screens/HomeScreen";
import { RoleSelectionScreen } from "../screens/RoleSelectionScreen";

export type RootStackParamList = {
  Home: undefined;
  RoleSelection: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{ headerShown: false }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="RoleSelection" component={RoleSelectionScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
