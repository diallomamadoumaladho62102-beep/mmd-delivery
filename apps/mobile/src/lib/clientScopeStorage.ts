import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "mmd_client_manual_scope_v1";

export type ClientManualScope = {
  countryCode: string;
  stateCode?: string | null;
  setAt: number;
};

export async function readManualClientScope(): Promise<ClientManualScope | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ClientManualScope;
    const countryCode = String(parsed?.countryCode ?? "")
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{2}$/.test(countryCode)) return null;
    return {
      countryCode,
      stateCode: parsed?.stateCode ? String(parsed.stateCode).trim().toUpperCase() : null,
      setAt: Number(parsed?.setAt ?? Date.now()),
    };
  } catch {
    return null;
  }
}

export async function writeManualClientScope(scope: ClientManualScope): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(scope));
}

export async function clearManualClientScope(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
