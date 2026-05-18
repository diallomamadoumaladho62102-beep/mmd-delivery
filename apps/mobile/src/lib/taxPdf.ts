import { Alert } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { supabase } from "./supabase";
import { API_BASE_URL } from "./apiBase";

const BASE_URL = String(API_BASE_URL ?? "").replace(/\/+$/, "");

type DriverTaxRange = "weekly" | "monthly" | "yearly";

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

function validateMonth(month: number) {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Invalid month");
  }
}

function validateWeek(week: number) {
  if (!Number.isInteger(week) || week < 1 || week > 53) {
    throw new Error("Invalid week");
  }
}

async function openDriverTaxPdf(params: {
  range: DriverTaxRange;
  year: number;
  month?: number;
  week?: number;
}) {
  const { range, year, month, week } = params;

  try {
    validateYear(year);

    if (range === "monthly") validateMonth(Number(month));
    if (range === "weekly") validateWeek(Number(week));

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

    const query = new URLSearchParams();

    query.set("year", String(year));

    if (range !== "yearly") {
      query.set("range", range);
    }

    if (range === "monthly" && month != null) {
      query.set("month", String(month));
    }

    if (range === "weekly" && week != null) {
      query.set("week", String(week));
    }

    const url = `${BASE_URL}/api/driver/tax/summary?${query.toString()}`;

    console.log(`openDriverTaxPdf(${range}) => URL:`, url);

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

      console.log(`openDriverTaxPdf(${range}) => error payload:`, json);

      throw new Error(String(message));
    }

    console.log(`openDriverTaxPdf(${range}) => routeVersion:`, json?.routeVersion);

    const signedUrl = json?.file?.signedUrl;

    if (!signedUrl || typeof signedUrl !== "string") {
      throw new Error("Missing signedUrl");
    }

    await WebBrowser.openBrowserAsync(signedUrl);
  } catch (error) {
    const message = getErrorMessage(error);

    console.log(`openDriverTaxPdf(${range}) error:`, message, error);

    Alert.alert("Erreur PDF", message);

    throw error;
  }
}

export async function openYearlyTaxPdf(year: number) {
  return openDriverTaxPdf({
    range: "yearly",
    year,
  });
}

export async function openMonthlyTaxPdf(year: number, month: number) {
  return openDriverTaxPdf({
    range: "monthly",
    year,
    month,
  });
}

export async function openWeeklyTaxPdf(year: number, week: number) {
  return openDriverTaxPdf({
    range: "weekly",
    year,
    week,
  });
}