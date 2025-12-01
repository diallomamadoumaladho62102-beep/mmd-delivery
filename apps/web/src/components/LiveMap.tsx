'use client';

import Map, { Marker } from 'react-map-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { useEffect, useState } from 'react';

type Props = { lat: number; lng: number };

export default function LiveMap({ lat, lng }: Props) {
  const [viewState, setViewState] = useState({
    latitude: lat,
    longitude: lng,
    zoom: 13,
  });

  useEffect(() => {
    setViewState((v) => ({ ...v, latitude: lat, longitude: lng }));
  }, [lat, lng]);

  return (
    <div className="h-64 w-full rounded-xl overflow-hidden border">
      <Map
        {...viewState}
        mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
        onMove={(e) => setViewState(e.viewState)}
        mapStyle="mapbox://styles/mapbox/streets-v11"
      >
        <Marker latitude={lat} longitude={lng} color="red" />
      </Map>
    </div>
  );
}


