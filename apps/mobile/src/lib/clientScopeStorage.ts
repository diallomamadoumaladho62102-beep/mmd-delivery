import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  manualScopeVisibleToUser,
  type ClientManualScope,
  type StoredClientManualScope,
} from "./clientScopeBinding";

const STORAGE_KEY = "mmd_client_manual_scope_v1";

export type { ClientManualScope };

export async function readManualClientScope(
  userId: string | null,
): Promise<ClientManualScope | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredClientManualScope;
    const decision = manualScopeVisibleToUser({
      stored: parsed,
      currentUserId: userId,
    });
    if (decision.clear) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
    return decision.scope;
  } catch {
    return null;
  }
}

export async function writeManualClientScope(
  scope: ClientManualScope,
  userId: string,
): Promise<void> {
  const owner = userId.trim();
  if (!owner) return;
  await AsyncStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...scope, userId: owner }),
  );
}

export async function clearManualClientScope(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
