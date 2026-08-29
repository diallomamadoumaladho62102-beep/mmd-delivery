import AsyncStorage from "@react-native-async-storage/async-storage";

type SecureStoreModule = {
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
  deleteItemAsync: (key: string) => Promise<void>;
};

const CHUNK_SIZE = 1800;
const CHUNK_PREFIX = "mmd.auth.chunk.";

function loadSecureStore(): SecureStoreModule | null {
  try {
    // Optional native module — web / tests fall back to AsyncStorage.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("expo-secure-store") as SecureStoreModule;
    if (mod?.getItemAsync && mod?.setItemAsync && mod?.deleteItemAsync) {
      return mod;
    }
  } catch {
    return null;
  }
  return null;
}

async function readChunks(store: SecureStoreModule, key: string): Promise<string | null> {
  const countRaw = await store.getItemAsync(`${CHUNK_PREFIX}${key}.count`);
  const count = Number(countRaw ?? 0);
  if (!Number.isFinite(count) || count <= 0) {
    return store.getItemAsync(`${CHUNK_PREFIX}${key}`);
  }
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const part = await store.getItemAsync(`${CHUNK_PREFIX}${key}.${i}`);
    if (part == null) return null;
    parts.push(part);
  }
  return parts.join("");
}

async function writeChunks(store: SecureStoreModule, key: string, value: string): Promise<void> {
  const previous = Number((await store.getItemAsync(`${CHUNK_PREFIX}${key}.count`)) ?? 0);
  const chunks = value.match(new RegExp(`.{1,${CHUNK_SIZE}}`, "g")) ?? [value];
  await store.setItemAsync(`${CHUNK_PREFIX}${key}.count`, String(chunks.length));
  for (let i = 0; i < chunks.length; i += 1) {
    await store.setItemAsync(`${CHUNK_PREFIX}${key}.${i}`, chunks[i]!);
  }
  for (let i = chunks.length; i < previous; i += 1) {
    await store.deleteItemAsync(`${CHUNK_PREFIX}${key}.${i}`);
  }
  await store.deleteItemAsync(`${CHUNK_PREFIX}${key}`);
}

async function deleteChunks(store: SecureStoreModule, key: string): Promise<void> {
  const previous = Number((await store.getItemAsync(`${CHUNK_PREFIX}${key}.count`)) ?? 0);
  for (let i = 0; i < Math.max(previous, 1); i += 1) {
    await store.deleteItemAsync(`${CHUNK_PREFIX}${key}.${i}`);
  }
  await store.deleteItemAsync(`${CHUNK_PREFIX}${key}.count`);
  await store.deleteItemAsync(`${CHUNK_PREFIX}${key}`);
}

/**
 * Supabase auth storage: prefer SecureStore (chunked), migrate once from
 * AsyncStorage so existing sessions are not logged out.
 */
export function createSecureAuthStorage(): {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
} {
  const secure = loadSecureStore();

  return {
    async getItem(key: string) {
      if (secure) {
        const fromSecure = await readChunks(secure, key);
        if (fromSecure != null) return fromSecure;
        const legacy = await AsyncStorage.getItem(key);
        if (legacy != null) {
          await writeChunks(secure, key, legacy);
          await AsyncStorage.removeItem(key);
          return legacy;
        }
        return null;
      }
      return AsyncStorage.getItem(key);
    },
    async setItem(key: string, value: string) {
      if (secure) {
        await writeChunks(secure, key, value);
        await AsyncStorage.removeItem(key);
        return;
      }
      await AsyncStorage.setItem(key, value);
    },
    async removeItem(key: string) {
      if (secure) {
        await deleteChunks(secure, key);
      }
      await AsyncStorage.removeItem(key);
    },
  };
}
