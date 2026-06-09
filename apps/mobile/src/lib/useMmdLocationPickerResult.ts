import { useEffect, useRef } from "react";
import {
  buildLocationDisplayAddress,
  type MmdLocationPickerContext,
  type MmdLocationPickerResult,
} from "./mmdLocationDisplay";
import type { MmdLocationPoint } from "./mmdLocationApi";

type PickerRouteParams = {
  locationPickerResult?: MmdLocationPickerResult;
};

type PickerNavigation = {
  setParams: (params: Record<string, unknown>) => void;
};

export function useMmdLocationPickerResult(
  route: { params?: PickerRouteParams },
  navigation: PickerNavigation,
  handlers: Partial<
    Record<MmdLocationPickerContext, (location: MmdLocationPoint) => void>
  >
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const pickerResult = route.params?.locationPickerResult;

  useEffect(() => {
    if (!pickerResult) return;

    handlersRef.current[pickerResult.context]?.(pickerResult.location);
    navigation.setParams({ locationPickerResult: undefined });
  }, [navigation, pickerResult]);
}

export function applyMmdLocationSelection(
  location: MmdLocationPoint,
  setters: {
    setLocationId: (value: string) => void;
    setAddress: (value: string) => void;
    setCoords?: (coords: { lat: number; lng: number }) => void;
    setCountryCode?: (value: string) => void;
  }
) {
  setters.setLocationId(location.id);
  setters.setAddress(buildLocationDisplayAddress(location));
  if (setters.setCoords) {
    setters.setCoords({ lat: location.pin_lat, lng: location.pin_lng });
  }
  if (setters.setCountryCode && location.country_code) {
    setters.setCountryCode(location.country_code);
  }
}
