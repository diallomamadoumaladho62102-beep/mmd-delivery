import { Alert, Linking } from "react-native";
import { supabase } from "./supabase";
import { API_BASE_URL } from "./apiBase";

type Role = "client" | "driver" | "restaurant" | "admin";

type StartMaskedCallParams = {
  orderId: string;
  callerRole: Role;
  targetRole: Role;
};

const BASE_URL = String(API_BASE_URL ?? "").replace(/\/+$/, "");

function getErrorMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as any).message === "string"
  ) {
    return (error as any).message;
  }

  return "Unable to start call";
}

export async function startMaskedCall({
  orderId,
  callerRole,
  targetRole,
}: StartMaskedCallParams) {
  try {
    if (!BASE_URL) {
      throw new Error("Missing API base URL");
    }

    if (!orderId) {
      throw new Error("Missing order ID");
    }

    if (!callerRole || !targetRole) {
      throw new Error("Missing call role");
    }

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError) {
      throw new Error(sessionError.message);
    }

    if (!session?.access_token) {
      throw new Error("Not authenticated");
    }

    const response = await fetch(
      `${BASE_URL}/api/twilio/calls/create`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          orderId,
          callerRole,
          targetRole,
        }),
      }
    );

    const json = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(
        json?.error || "Unable to create call session"
      );
    }

    const proxyNumber = String(json?.proxyNumber || "").trim();

    if (!proxyNumber) {
      throw new Error("Missing proxy number");
    }

    const supported = await Linking.canOpenURL(
      `tel:${proxyNumber}`
    );

    if (!supported) {
      throw new Error("Phone calls are not supported on this device");
    }

    await Linking.openURL(`tel:${proxyNumber}`);

    return {
      success: true,
      proxyNumber,
      session: json?.session ?? null,
    };
  } catch (error) {
    const message = getErrorMessage(error);

    console.error("startMaskedCall error:", error);

    Alert.alert("Call error", message);

    throw error;
  }
}