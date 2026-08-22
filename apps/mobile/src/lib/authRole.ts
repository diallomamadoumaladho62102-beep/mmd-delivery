import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "mmd:selected_role";

export type UserRole = "client" | "driver" | "restaurant" | "seller";

export async function setSelectedRole(role: UserRole) {
  await AsyncStorage.setItem(KEY, role);
}

export async function getSelectedRole(): Promise<UserRole | null> {
  const v = await AsyncStorage.getItem(KEY);
  if (v === "client" || v === "driver" || v === "restaurant" || v === "seller") {
    return v;
  }
  return null;
}

export async function clearSelectedRole() {
  await AsyncStorage.removeItem(KEY);
}

export type PostAuthRoute =
  | "ClientHome"
  | "SellerGate"
  | "RestaurantGate";

/** Route to open immediately after login/signup based on RoleSelect choice. */
export async function resolvePostAuthRoute(): Promise<PostAuthRoute> {
  const role = await getSelectedRole();
  if (role === "seller") return "SellerGate";
  if (role === "restaurant") return "RestaurantGate";
  return "ClientHome";
}
