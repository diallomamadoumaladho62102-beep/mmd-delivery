import React, { useEffect, useState } from "react";
import { ScrollView, Text, TouchableOpacity, View } from "react-native";
import { useTranslation } from "react-i18next";
import { formatMoneyFromCents } from "../../i18n/formatters";
import { fetchGuineaXlDepartures, openGuineaXlDeparture } from "../../lib/taxiXlApi";

type Axis = {
  id: string;
  origin_label: string;
  destination_label: string;
  front_seat_gnf: number;
  other_seat_gnf: number;
};

export default function DriverGuineaXlScreen() {
  const { t } = useTranslation();
  const [axes, setAxes] = useState<Axis[]>([]);
  const [capacity, setCapacity] = useState<4 | 5 | 6 | 7>(4);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void fetchGuineaXlDepartures()
      .then((payload) => setAxes((payload.axes ?? []) as Axis[]))
      .catch((cause: unknown) => setMessage(cause instanceof Error ? cause.message : t("taxiXl.requestFailed")));
  }, [t]);

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Text style={{ fontSize: 22, fontWeight: "700" }}>{t("taxiXl.driverTitle")}</Text>
      <Text>{t("taxiXl.driverHint")}</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {([4, 5, 6, 7] as const).map((value) => (
          <TouchableOpacity key={value} onPress={() => setCapacity(value)}>
            <Text>
              {value} {capacity === value ? "· ✓" : ""}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      {axes.map((axis) => (
        <TouchableOpacity
          key={axis.id}
          onPress={() => {
            void openGuineaXlDeparture({ axisId: axis.id, capacity })
              .then(() => setMessage(t("taxiXl.departureOpened")))
              .catch((cause: unknown) =>
                setMessage(cause instanceof Error ? cause.message : t("taxiXl.requestFailed")),
              );
          }}
        >
          <Text>
            {axis.origin_label} ↔ {axis.destination_label}
          </Text>
          <Text>
            {t("taxiXl.frontSeat")} {formatMoneyFromCents(axis.front_seat_gnf, "GNF")} · {t("taxiXl.otherSeat")}{" "}
            {formatMoneyFromCents(axis.other_seat_gnf, "GNF")}
          </Text>
          <Text>{t("taxiXl.driverAmountNote")}</Text>
        </TouchableOpacity>
      ))}
      {message ? <Text>{message}</Text> : null}
    </ScrollView>
  );
}
