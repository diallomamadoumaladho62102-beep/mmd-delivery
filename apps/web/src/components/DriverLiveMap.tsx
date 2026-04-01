"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useDriverLocation } from "@/hooks/useDriverLocation";

// Import dynamique de react-map-gl (sinon problème SSR avec Next)
const Map = dynamic(
  () => import("react-map-gl").then((mod) => mod.default),
  { ssr: false }
);

const Marker = dynamic(
  () => import("react-map-gl").then((mod) => mod.Marker),
  { ssr: false }
);

type Props = {
  driverId: string | null;
};

export function DriverLiveMap({ driverId }: Props) {
  const { location, loading, error } = useDriverLocation(driverId);

  const token = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN;

  // 🗺️ état de la vue de la carte (centrage + zoom)
  const [viewState, setViewState] = useState({
    longitude: -73.935242, // NYC par défaut
    latitude: 40.73061,
    zoom: 11,
  });

  // 🎯 quand on a une position chauffeur, on recentre la carte dessus
  useEffect(() => {
    if (location) {
      setViewState((prev) => ({
        ...prev,
        longitude: location.lng,
        latitude: location.lat,
        zoom: 14,
      }));
    }
  }, [location]);

  if (!token) {
    return (
      <p className="text-xs text-red-600">
        Mapbox n&apos;est pas configuré (NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN manquant).
      </p>
    );
  }

  // 🚨 Aucun chauffeur assigné
  if (!driverId) {
    return (
      <p className="text-xs text-gray-500">
        Aucun chauffeur n&apos;est encore assigné à cette commande.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {loading && !location && (
        <p className="text-xs text-gray-500">
          Récupération de la position du chauffeur…
        </p>
      )}

      {error && (
        <p className="text-xs text-red-600">
          Erreur récupération position du chauffeur : {error}
        </p>
      )}

      <div className="h-64 w-full overflow-hidden rounded-lg border border-gray-200">
        <Map
          {...viewState}
          onMove={(evt) => setViewState(evt.viewState)}
          mapStyle="mapbox://styles/mapbox/streets-v12"
          mapboxAccessToken={token}
          style={{ width: "100%", height: "100%" }}
        >
          {location && (
            <Marker
              longitude={location.lng}
              latitude={location.lat}
              anchor="center"
            >
              {/* 🔴 GROS MARQUEUR VERT BIEN VISIBLE */}
              <div className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white bg-emerald-500 shadow-lg">
                <span className="text-[9px] font-bold text-white">D</span>
              </div>
            </Marker>
          )}
        </Map>
      </div>

      {location && (
        <p className="text-[11px] text-gray-500">
          Dernière position du chauffeur :{" "}
          {location.lat.toFixed(5)}, {location.lng.toFixed(5)} — mise à jour le{" "}
          {new Date(location.updated_at).toLocaleTimeString("fr-FR", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </p>
      )}
    </div>
  );
}
