import { supabase } from "./supabase";
import * as WebBrowser from "expo-web-browser";
import { API_BASE_URL } from "./apiBase";

export type TinType = "SSN" | "EIN";

export type W9GetResponse =
  | { status: "missing" }
  | {
      status: "signed";
      signedAt: string | null;
      tin: { type: TinType; masked: string };
      profile: {
        legalName: string;
        businessName?: string;
        entityType: string;
        address1?: string;
        address2?: string;
        city?: string;
        state?: string;
        zip?: string;
        signedName?: string;
      };
      file: { bucket: string; path: string; signedUrl: string | null } | null;
    };

export type W9PostResponse =
  | {
      status: "signed";
      signedAt: string;
      tin: { type: TinType; masked: string };
      file: { bucket: string; path: string; signedUrl: string; expiresInSeconds?: number };
    }
  | { error: string };

export type W9Payload = {
  legal_name: string;
  business_name?: string;
  entity_type: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  zip: string;
  tin_type: TinType;
  tin?: string;
  signed_name: string;
};

function apiBaseUrl() {
  const url = API_BASE_URL?.trim();
  if (!url) throw new Error("Missing API_BASE_URL");
  return url.replace(/\/+$/, "");
}

async function getAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return token;
}

export async function w9Get(): Promise<W9GetResponse> {
  const base = apiBaseUrl();
  const token = await getAccessToken();

  const res = await fetch(`${base}/api/driver/tax/w9`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = json?.error ?? `GET W9 failed (${res.status})`;
    throw new Error(msg);
  }

  return json as W9GetResponse;
}

export async function w9Submit(payload: W9Payload): Promise<W9PostResponse> {
  const base = apiBaseUrl();
  const token = await getAccessToken();

  const res = await fetch(`${base}/api/driver/tax/w9`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => null);

  if (!res.ok) {
    const msg = json?.error ?? `POST W9 failed (${res.status})`;
    throw new Error(msg);
  }

  return json as W9PostResponse;
}

export async function openW9Pdf(signedUrl: string) {
  if (!signedUrl) throw new Error("No signedUrl");
  await WebBrowser.openBrowserAsync(signedUrl);
}