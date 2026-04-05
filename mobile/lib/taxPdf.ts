// apps/mobile/lib/taxPdf.ts
import { Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";
import { API_BASE_URL } from "../src/lib/apiBase";

const BASE_URL = API_BASE_URL;

export async function openYearlyTaxPdf(year: number) {
  try {
    if (!Number.isInteger(year) || year < 2000) {
      throw new Error("Invalid year");
    }

    // 1) session
    const { data, error } = await supabase.auth.getSession();
    if (error) {
      throw new Error(error.message);
    }

    const token = data?.session?.access_token;
    if (!token) {
      throw new Error("Not authenticated");
    }

    // 2) call the tax summary route
    const url = `${BASE_URL}/api/driver/tax/summary?year=${year}`;
    console.log("openYearlyTaxPdf => URL:", url);

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    const json = await res.json().catch(() => null);

    if (!res.ok) {
      const msg =
        json?.error ||
        json?.message ||
        `HTTP ${res.status}`;
      console.log("openYearlyTaxPdf => error payload:", json);
      throw new Error(msg);
    }

    // Debug: confirm backend version
    console.log("openYearlyTaxPdf => routeVersion:", json?.routeVersion);

    const signedUrl = json?.file?.signedUrl;
    if (!signedUrl || typeof signedUrl !== "string") {
      throw new Error("Missing signedUrl");
    }

    // 3) open PDF
    await WebBrowser.openBrowserAsync(signedUrl);
  } catch (e: any) {
    const message =
      typeof e?.message === "string" && e.message.trim().length > 0
        ? e.message
        : "Unknown error";

    console.log("openYearlyTaxPdf error:", message, e);
    Alert.alert("Erreur", "Impossible de télécharger le PDF pour le moment.");
    throw e;
  }
}

