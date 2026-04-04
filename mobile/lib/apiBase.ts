import Constants from "expo-constants";
import { NativeModules } from "react-native";

const PRODUCTION_API_URL = "https://mmd-delivery.vercel.app";
const LOCAL_API_PORT = "3000";

function safeTrim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function ensureHttpProtocol(value: string): string {
  const trimmed = safeTrim(value);
  if (!trimmed) return "";

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return stripTrailingSlash(trimmed);
  }

  return stripTrailingSlash(`https://${trimmed}`);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function normalizeApiUrl(value: unknown): string {
  const normalized = ensureHttpProtocol(safeTrim(value));
  return isValidHttpUrl(normalized) ? normalized : "";
}

function extractHostFromUrlLike(value: string): string | null {
  if (!value) return null;

  try {
    if (value.startsWith("http://") || value.startsWith("https://")) {
      return new URL(value).hostname;
    }

    const hostPart = value.split("/")[0];
    return hostPart.split(":")[0] || null;
  } catch {
    return null;
  }
}

function isLocalHost(host: string | null): boolean {
  if (!host) return false;

  const h = host.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

function isPrivateLanHost(host: string | null): boolean {
  if (!host) return false;

  return (
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  );
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

function getRuntimeEnvApiUrls(): { localUrl: string; prodUrl: string } {
  try {
    const env = (globalThis as any)?.process?.env;

    return {
      localUrl: normalizeApiUrl(env?.EXPO_PUBLIC_API_URL_LOCAL),
      prodUrl: normalizeApiUrl(env?.EXPO_PUBLIC_API_URL_PROD),
    };
  } catch {
    return {
      localUrl: "",
      prodUrl: "",
    };
  }
}

function getExpoExtraApiUrls(): { localUrl: string; prodUrl: string } {
  const extra = (Constants.expoConfig?.extra as any) ?? {};

  return {
    localUrl: normalizeApiUrl(extra?.EXPO_PUBLIC_API_URL_LOCAL),
    prodUrl: normalizeApiUrl(extra?.EXPO_PUBLIC_API_URL_PROD),
  };
}

function getLocalDevApiUrlFromMetro(): string {
  const metroHost = getMetroHost();

  if (!metroHost) return "";
  if (isLocalHost(metroHost)) return "";
  if (!isPrivateLanHost(metroHost)) return "";

  return `http://${metroHost}:${LOCAL_API_PORT}`;
}

export function getApiBaseUrl(): string {
  // 1) priorité à Expo extra
  const expoUrls = getExpoExtraApiUrls();

  if (__DEV__ && expoUrls.localUrl) {
    return expoUrls.localUrl;
  }

  if (expoUrls.prodUrl) {
    return expoUrls.prodUrl;
  }

  // 2) fallback runtime env
  const envUrls = getRuntimeEnvApiUrls();

  if (__DEV__ && envUrls.localUrl) {
    return envUrls.localUrl;
  }

  if (envUrls.prodUrl) {
    return envUrls.prodUrl;
  }

  // 3) fallback dev local via IP Metro
  if (__DEV__) {
    const metroLocalUrl = getLocalDevApiUrlFromMetro();
    if (metroLocalUrl) {
      return metroLocalUrl;
    }
  }

  // 4) fallback final production
  return PRODUCTION_API_URL;
}

export const API_BASE_URL = getApiBaseUrl();

if (__DEV__) {
  const extra = (Constants.expoConfig?.extra as any) ?? {};
  console.log("🌐 APP_ENV =", extra?.APP_ENV ?? "development");
  console.log("🌐 API_BASE_URL =", API_BASE_URL);
}