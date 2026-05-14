import { Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";
import { API_BASE_URL } from "./apiBase";

const BASE_URL = String(API_BASE_URL ?? "").replace(/\/+$/, "");

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }

  return "Unknown error";
}

function validateYear(year: number) {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error("Invalid year");
  }
}

export async function openYearlyTaxPdf(year: number) {
  try {
    validateYear(year);

    if (!BASE_URL) {
      throw new Error("Missing API base URL");
    }

    const { data, error } = await supabase.auth.getSession();

    if (error) {
      throw new Error(error.message);
    }

    const token = data?.session?.access_token;

    if (!token) {
      throw new Error("Not authenticated");
    }

    const url = `${BASE_URL}/api/driver/tax/summary?year=${year}`;

    console.log("openYearlyTaxPdf => URL:", url);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    const json = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        json?.error ||
        json?.message ||
        json?.details ||
        `HTTP ${response.status}`;

      console.log("openYearlyTaxPdf => error payload:", json);

      throw new Error(String(message));
    }

    console.log("openYearlyTaxPdf => routeVersion:", json?.routeVersion);

    const signedUrl = json?.file?.signedUrl;

    if (!signedUrl || typeof signedUrl !== "string") {
      throw new Error("Missing signedUrl");
    }

    await WebBrowser.openBrowserAsync(signedUrl);
  } catch (error) {
    const message = getErrorMessage(error);

    console.log("openYearlyTaxPdf error:", message, error);

    Alert.alert("Erreur PDF", message);

    throw error;
  }
}