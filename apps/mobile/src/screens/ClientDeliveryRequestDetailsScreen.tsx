import React, { useEffect, useMemo, useState } from "react";
import {
  SafeAreaView,
  View,
  Text,
  StatusBar,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { supabase } from "../lib/supabase";

type DeliveryRequestRow = {
  id: string;
  status: string | null;
  payment_status: string | null;
  created_at: string | null;
  updated_at: string | null;
  paid_at: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  distance_miles: number | null;
  total: number | null;
  delivery_fee: number | null;
  stripe_session_id: string | null;
  stripe_payment_intent_id: string | null;
};

function toSafeString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function toSafeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : typeof value === "string" && value.trim() && !Number.isNaN(Number(value))
    ? Number(value)
    : null;
}

function formatCurrency(amount: number | null | undefined) {
  if (typeof amount !== "number" || Number.isNaN(amount)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function formatDistance(distance: number | null | undefined) {
  if (typeof distance !== "number" || Number.isNaN(distance)) return "—";
  return `${distance.toFixed(1)} mi`;
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";

  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function statusColor(status: string | null) {
  if (status === "delivered") return "#86EFAC";
  if (status === "canceled") return "#FCA5A5";
  if (status === "dispatched") return "#93C5FD";
  return "#CBD5E1";
}

function paymentColor(status: string | null) {
  if (status === "paid") return "#86EFAC";
  if (status === "processing") return "#FDE68A";
  if (status === "unpaid") return "#FCA5A5";
  return "#CBD5E1";
}

function InfoCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <View
      style={{
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)",
        backgroundColor: "rgba(15,23,42,0.92)",
        padding: 14,
        marginBottom: 12,
      }}
    >
      <Text
        style={{
          color: "#94A3B8",
          fontSize: 12,
          fontWeight: "700",
          marginBottom: 6,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          color: "white",
          fontSize: 15,
          fontWeight: "800",
        }}
      >
        {value || "—"}
      </Text>
    </View>
  );
}

export function ClientDeliveryRequestDetailsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const requestId = route?.params?.requestId as string | undefined;

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<DeliveryRequestRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      if (!requestId) {
        if (!alive) return;
        setError("Missing requestId.");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        const { data, error } = await supabase
          .from("delivery_requests")
          .select(
            `
            id,
            status,
            payment_status,
            created_at,
            updated_at,
            paid_at,
            pickup_address,
            dropoff_address,
            distance_miles,
            total,
            delivery_fee,
            stripe_session_id,
            stripe_payment_intent_id
          `
          )
          .eq("id", requestId)
          .maybeSingle();

        if (error) throw error;

        if (!alive) return;

        if (!data) {
          setData(null);
          setError("Delivery request not found.");
          return;
        }

        setData({
          id: String(data.id),
          status: toSafeString(data.status),
          payment_status: toSafeString(data.payment_status),
          created_at: toSafeString(data.created_at),
          updated_at: toSafeString(data.updated_at),
          paid_at: toSafeString(data.paid_at),
          pickup_address: toSafeString(data.pickup_address),
          dropoff_address: toSafeString(data.dropoff_address),
          distance_miles: toSafeNumber(data.distance_miles),
          total: toSafeNumber(data.total),
          delivery_fee: toSafeNumber(data.delivery_fee),
          stripe_session_id: toSafeString(data.stripe_session_id),
          stripe_payment_intent_id: toSafeString(data.stripe_payment_intent_id),
        });
      } catch (e: any) {
        if (!alive) return;
        console.log("load delivery request details error:", e);
        setError(e?.message ?? "Unable to load delivery request.");
      } finally {
        if (alive) setLoading(false);
      }
    };

    load();

    return () => {
      alive = false;
    };
  }, [requestId]);

  const title = useMemo(() => {
    if (!data?.id) return "Delivery Request";
    return `🚗 Delivery Request #${data.id.slice(0, 8)}`;
  }, [data?.id]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#030617" }}>
      <StatusBar barStyle="light-content" />

      <View
        style={{
          paddingHorizontal: 18,
          paddingTop: 16,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: "rgba(255,255,255,0.06)",
          backgroundColor: "#030617",
        }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} activeOpacity={0.8}>
          <Text
            style={{
              color: "#93C5FD",
              fontSize: 14,
              fontWeight: "800",
              marginBottom: 10,
            }}
          >
            ← Back
          </Text>
        </TouchableOpacity>

        <Text
          style={{
            color: "white",
            fontSize: 22,
            fontWeight: "900",
          }}
        >
          {title}
        </Text>

        <Text
          style={{
            color: "#94A3B8",
            marginTop: 6,
            fontSize: 13,
          }}
        >
          Request details and payment status
        </Text>
      </View>

      {loading ? (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <ActivityIndicator color="white" />
          <Text style={{ color: "#94A3B8", marginTop: 12 }}>
            Loading request...
          </Text>
        </View>
      ) : error ? (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <Text
            style={{
              color: "#FCA5A5",
              fontSize: 15,
              fontWeight: "800",
              textAlign: "center",
              marginBottom: 8,
            }}
          >
            Unable to load this request
          </Text>
          <Text
            style={{
              color: "#94A3B8",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            {error}
          </Text>
        </View>
      ) : !data ? (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: 24,
          }}
        >
          <Text style={{ color: "white", fontSize: 16, fontWeight: "800" }}>
            No request found
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{
            padding: 18,
            paddingBottom: 36,
          }}
          showsVerticalScrollIndicator={false}
        >
          <View
            style={{
              borderRadius: 24,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",
              backgroundColor: "rgba(15,23,42,0.96)",
              padding: 16,
              marginBottom: 14,
            }}
          >
            <Text
              style={{
                color: "#94A3B8",
                fontSize: 12,
                marginBottom: 6,
              }}
            >
              Current status
            </Text>
            <Text
              style={{
                color: statusColor(data.status),
                fontSize: 18,
                fontWeight: "900",
                marginBottom: 14,
              }}
            >
              {data.status ?? "pending"}
            </Text>

            <Text
              style={{
                color: "#94A3B8",
                fontSize: 12,
                marginBottom: 6,
              }}
            >
              Payment status
            </Text>
            <Text
              style={{
                color: paymentColor(data.payment_status),
                fontSize: 16,
                fontWeight: "900",
              }}
            >
              {data.payment_status ?? "unpaid"}
            </Text>
          </View>

          <InfoCard label="Pickup address" value={data.pickup_address ?? "—"} />
          <InfoCard label="Dropoff address" value={data.dropoff_address ?? "—"} />

          <View style={{ flexDirection: "row", gap: 10, marginBottom: 2 }}>
            <View style={{ flex: 1 }}>
              <InfoCard
                label="Distance"
                value={formatDistance(data.distance_miles)}
              />
            </View>
            <View style={{ flex: 1 }}>
              <InfoCard
                label="Delivery fee"
                value={formatCurrency(data.delivery_fee)}
              />
            </View>
          </View>

          <InfoCard label="Total" value={formatCurrency(data.total)} />
          <InfoCard label="Created at" value={formatDateTime(data.created_at)} />
          <InfoCard label="Updated at" value={formatDateTime(data.updated_at)} />
          <InfoCard label="Paid at" value={formatDateTime(data.paid_at)} />

          <InfoCard
            label="Stripe session ID"
            value={data.stripe_session_id ?? "—"}
          />
          <InfoCard
            label="Stripe payment intent ID"
            value={data.stripe_payment_intent_id ?? "—"}
          />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export default ClientDeliveryRequestDetailsScreen;