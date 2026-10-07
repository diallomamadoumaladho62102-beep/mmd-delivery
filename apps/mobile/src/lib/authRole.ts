import AsyncStorage from "@react-native-async-storage/async-storage";
import { roleVisibleToUser, type BoundPublicRole } from "./selectedRoleBinding";

const KEY = "mmd:selected_role";
const UID_KEY = "mmd:selected_role_user_id";

export type UserRole = "client" | "driver" | "restaurant" | "seller";

export async function setSelectedRole(role: UserRole) {
  await AsyncStorage.setItem(KEY, role);
  await AsyncStorage.removeItem(UID_KEY);
}

export async function getSelectedRole(): Promise<UserRole | null> {
  const v = await AsyncStorage.getItem(KEY);
  if (v === "client" || v === "driver" || v === "restaurant" || v === "seller") {
    return v;
  }
  return null;
}

export async function clearSelectedRole() {
  await AsyncStorage.multiRemove([KEY, UID_KEY]);
}

/**
 * Role cache bound to the current auth user.
 * User A's cached role is cleared and ignored when user B is signed in.
 */
export async function getSelectedRoleForUser(
  userId: string,
): Promise<BoundPublicRole | null> {
  const [storedRole, storedUserId] = await Promise.all([
    AsyncStorage.getItem(KEY),
    AsyncStorage.getItem(UID_KEY),
  ]);
  const decision = roleVisibleToUser({
    storedRole,
    storedUserId,
    currentUserId: userId,
  });
  if (decision.clear) {
    await clearSelectedRole();
    return null;
  }
  if (decision.bindUserId) {
    await AsyncStorage.setItem(UID_KEY, decision.bindUserId);
  }
  return decision.role;
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
