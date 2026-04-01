import Constants from "expo-constants";
import { NativeModules } from "react-native";

function safeTrim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function extractHostFromUrlLike(value: string): string | null {
  if (!value) return null;

  try {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return new URL(value).hostname;
    }

    const hostPart = value.split("/")[0];
    const hostname = hostPart.split(":")[0];
    return hostname || null;
  } catch {
    return null;
  }
}

function getMetroHost(): string | null {
  try {
    const scriptURL: string | undefined = NativeModules?.SourceCode?.scriptURL;
    const fromScript = extractHostFromUrlLike(safeTrim(scriptURL));
    if (fromScript) return fromScript;
  } catch {}

  try {
    const debuggerHost = safeTrim((Constants as any)?.expoGoConfig?.debuggerHost);
    const fromDebugger = extractHostFromUrlLike(debuggerHost);
    if (fromDebugger) return fromDebugger;
  } catch {}

  try {
    const hostUri = safeTrim((Constants as any)?.expoConfig?.hostUri);
    const fromHostUri = extractHostFromUrlLike(hostUri);
    if (fromHostUri) return fromHostUri;
  } catch {}

  return null;
}

export function getApiBaseUrl(): string {
  const explicitEnv = safeTrim(process.env.EXPO_PUBLIC_API_URL);
  if (explicitEnv) {
    return explicitEnv;
  }

  const explicitExtra = safeTrim(
    (Constants.expoConfig?.extra as any)?.EXPO_PUBLIC_WEB_BASE_URL
  );
  if (!__DEV__ && explicitExtra) {
    return explicitExtra;
  }

  const metroHost = getMetroHost();
  if (__DEV__ && metroHost) {
    return `http://${metroHost}:3000`;
  }

  if (explicitExtra) {
    return explicitExtra;
  }

  return "http://localhost:3000";
}

export const API_BASE_URL = getApiBaseUrl();