import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "mmd:selected_role";

export type UserRole = "client" | "driver" | "restaurant";

export async function setSelectedRole(role: UserRole) {
  await AsyncStorage.setItem(KEY, role);
}

export async function getSelectedRole(): Promise<UserRole | null> {
  const v = await AsyncStorage.getItem(KEY);
  if (v === "client" || v === "driver" || v === "restaurant") {
    return v;
  }
  return null;
}

export async function clearSelectedRole() {
  await AsyncStorage.removeItem(KEY);
}
