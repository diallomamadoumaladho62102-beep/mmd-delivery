import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  roleVisibleToUser,
  shouldClearPrivateDeviceState,
  type BoundPublicRole,
} from "./selectedRoleBinding";

const KEY = "mmd:selected_role";
const UID_KEY = "mmd:selected_role_user_id";
const PRIVATE_OWNER_KEY = "mmd:device_private_owner";
const PRIVATE_DEVICE_KEYS = [
  "mmd_driver_is_online",
  "mmd_driver_trip_history_v1",
  "mmd.driver.service_preferences.v1",
  "mmd.driver.vehicle_snapshot.v1",
];

export async function clearUserPrivateDeviceState(): Promise<void> {
  await AsyncStorage.multiRemove(PRIVATE_DEVICE_KEYS);
  const { clearAiLocalHistory } = await import("./mmdAiLocalHistory");
  await clearAiLocalHistory();
}

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
  await AsyncStorage.multiRemove([KEY, UID_KEY, PRIVATE_OWNER_KEY]);
  await clearUserPrivateDeviceState();
  const { clearManualClientScope } = await import("./clientScopeStorage");
  await clearManualClientScope();
  const { clearMarketplaceSessionScope } = await import("./marketplaceScope");
  clearMarketplaceSessionScope();
}

/**
 * Role cache bound to the current auth user.
 * User A's cached role is cleared and ignored when user B is signed in.
 */
export async function getSelectedRoleForUser(
  userId: string,
): Promise<BoundPublicRole | null> {
  const [storedRole, storedUserId, privateOwner] = await Promise.all([
    AsyncStorage.getItem(KEY),
    AsyncStorage.getItem(UID_KEY),
    AsyncStorage.getItem(PRIVATE_OWNER_KEY),
  ]);
  if (shouldClearPrivateDeviceState(privateOwner, userId)) {
    await clearUserPrivateDeviceState();
  }
  if (privateOwner !== userId) {
    await AsyncStorage.setItem(PRIVATE_OWNER_KEY, userId);
  }
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
