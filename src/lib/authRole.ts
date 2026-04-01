import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "mmd:selected_role";

export type UserRole = "client" | "driver" | "restaurant";

export async function setSelectedRole(role: UserRole) {
  await AsyncStorage.setItem(KEY, role);
}

export async function getSelectedRole(): Promise<UserRole | null> {
  const value = await AsyncStorage.getItem(KEY);
  if (value === "client" || value === "driver" || value === "restaurant") {
    return value;
  }
  return null;
}

export async function clearSelectedRole() {
  await AsyncStorage.removeItem(KEY);
}
