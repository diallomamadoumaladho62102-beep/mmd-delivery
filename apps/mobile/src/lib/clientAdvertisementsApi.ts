import { API_BASE_URL } from "./apiBase";
import { supabase } from "./supabase";
import { logTechnicalError } from "./userFacingError";

export type ClientAdvertisement = {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string;
  button_text: string | null;
  button_action: string | null;
  category: string;
  priority: number;
  display_order: number;
};

async function getAuthHeaders() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  if (!token) throw new Error("Session expired. Please sign in again.");
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

function baseUrl() {
  return String(API_BASE_URL).replace(/\/$/, "");
}

export async function fetchClientAdvertisements(params?: {
  placement?: string;
  country?: string | null;
  city?: string | null;
  language?: string | null;
  limit?: number;
}): Promise<ClientAdvertisement[]> {
  const placement = params?.placement ?? "client_home";
  const limit = Math.min(20, Math.max(1, params?.limit ?? 12));

  try {
    const q = new URLSearchParams();
    q.set("placement", placement);
    if (params?.country) q.set("country", params.country);
    if (params?.city) q.set("city", params.city);
    if (params?.language) q.set("language", params.language);
    q.set("limit", String(limit));

    const res = await fetch(`${baseUrl()}/api/client/advertisements?${q.toString()}`, {
      method: "GET",
      headers: await getAuthHeaders(),
    });
    const out = await res.json().catch(() => null);
    if (res.ok && out?.ok !== false && Array.isArray(out?.advertisements)) {
      return out.advertisements as ClientAdvertisement[];
    }
    console.warn("[client.ads.list]", out?.error ?? res.status);
  } catch (e) {
    console.warn("[client.ads.list]", e);
  }

  // Fallback: read active CMS rows via Supabase when web API is not deployed yet.
  try {
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("advertisements")
      .select(
        "id, title, subtitle, image_url, button_text, button_action, category, priority, display_order, country, city, language, start_date, end_date",
      )
      .eq("is_active", true)
      .eq("placement", placement)
      .order("priority", { ascending: false })
      .order("display_order", { ascending: true })
      .limit(80);

    if (error) {
      console.warn("[client.ads.list.fallback]", error.message);
      return [];
    }

    const country = params?.country?.trim().toLowerCase() || null;
    const city = params?.city?.trim().toLowerCase() || null;
    const language = params?.language?.trim().toLowerCase() || null;

    const mapped = (data ?? [])
      .filter((row) => {
        const startOk = !row.start_date || String(row.start_date) <= nowIso;
        const endOk = !row.end_date || String(row.end_date) >= nowIso;
        if (!startOk || !endOk) return false;
        // Global ads (null country/city/language) always match.
        if (row.country && country && String(row.country).toLowerCase() !== country) return false;
        if (row.city && city && String(row.city).toLowerCase() !== city) return false;
        if (row.language && language && String(row.language).toLowerCase() !== language) {
          return false;
        }
        return Boolean(row.image_url && row.title);
      })
      .slice(0, limit)
      .map((row) => ({
        id: String(row.id),
        title: String(row.title),
        subtitle: row.subtitle != null ? String(row.subtitle) : null,
        image_url: String(row.image_url),
        button_text: row.button_text != null ? String(row.button_text) : null,
        button_action: row.button_action != null ? String(row.button_action) : null,
        category: String(row.category ?? "Campagnes MMD"),
        priority: Number(row.priority ?? 0),
        display_order: Number(row.display_order ?? 0),
      }));

    if (__DEV__) {
      console.log("[client.ads.list.fallback]", {
        raw: (data ?? []).length,
        mapped: mapped.length,
        country,
        language,
      });
    }
    return mapped;
  } catch (e) {
    console.warn("[client.ads.list.fallback]", e);
    return [];
  }
}

export async function trackAdvertisementEvent(input: {
  event: "impression" | "click";
  advertisementId: string;
  country?: string | null;
  city?: string | null;
  language?: string | null;
  placement?: string;
}): Promise<void> {
  try {
    const res = await fetch(`${baseUrl()}/api/client/advertisements/events`, {
      method: "POST",
      headers: await getAuthHeaders(),
      body: JSON.stringify({
        event: input.event,
        advertisement_id: input.advertisementId,
        country: input.country ?? null,
        city: input.city ?? null,
        language: input.language ?? null,
        placement: input.placement ?? "client_home",
      }),
    });
    if (!res.ok) {
      const out = await res.json().catch(() => null);
      logTechnicalError("client.ads.event", out, { status: res.status });
    }
  } catch (e) {
    logTechnicalError("client.ads.event", e);
  }
}
