import { useEffect, useState } from "react";

export type DeviceLocationStatus = "idle" | "requesting" | "granted" | "denied" | "unsupported" | "error";

export interface DeviceLocationState {
  lat: number | null;
  lng: number | null;
  accuracyMeters: number | null;
  status: DeviceLocationStatus;
  errorMessage: string | null;
}

/**
 * Requests the browser's real GPS/location permission on mount and keeps
 * tracking it via watchPosition (not a single getCurrentPosition snapshot),
 * so the "you are here" marker follows the operator's device as it moves --
 * standard behavior for a live dispatch map, not a one-time lookup.
 */
export function useDeviceLocation(): DeviceLocationState {
  const [state, setState] = useState<DeviceLocationState>({
    lat: null,
    lng: null,
    accuracyMeters: null,
    status: "idle",
    errorMessage: null,
  });

  useEffect(() => {
    if (!navigator.geolocation) {
      setState((s) => ({ ...s, status: "unsupported" }));
      return;
    }

    setState((s) => ({ ...s, status: "requesting" }));

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setState({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyMeters: pos.coords.accuracy,
          status: "granted",
          errorMessage: null,
        });
      },
      (err) => {
        setState((s) => ({
          ...s,
          status: err.code === err.PERMISSION_DENIED ? "denied" : "error",
          errorMessage: err.message,
        }));
      },
      { enableHighAccuracy: true, maximumAge: 10_000, timeout: 15_000 },
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  return state;
}
