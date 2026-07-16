import { useEffect, useState } from "react";

export interface NearbyHospital {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address: string | null;
  rating: number | null;
  openNow: boolean | null;
}

interface PlacesNearbySearchResponse {
  places?: Array<{
    id: string;
    displayName?: { text?: string };
    formattedAddress?: string;
    rating?: number;
    currentOpeningHours?: { openNow?: boolean };
    location?: { latitude: number; longitude: number };
  }>;
}

const SEARCH_RADIUS_METERS = 8000;

/**
 * Real nearby hospitals from Google Places API (New) "Nearby Search",
 * centered on the device's actual GPS position -- separate from the
 * simulated AEGIS fleet (useDispatchStore's hospitals), which is seeded
 * demo data for the dispatch pipeline, not real-world POIs. Re-queries
 * whenever the device location moves far enough to matter, not on every
 * GPS jitter update (watchPosition can fire every few seconds).
 */
export function useNearbyHospitals(lat: number | null, lng: number | null, apiKey: string | undefined) {
  const [hospitals, setHospitals] = useState<NearbyHospital[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Round to ~1km grid so small GPS jitter doesn't refire the search.
  const roundedLat = lat !== null ? Math.round(lat * 100) / 100 : null;
  const roundedLng = lng !== null ? Math.round(lng * 100) / 100 : null;

  useEffect(() => {
    if (roundedLat === null || roundedLng === null || !apiKey) return;

    const controller = new AbortController();
    setIsLoading(true);
    setError(null);

    fetch("https://places.googleapis.com/v1/places:searchNearby", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.currentOpeningHours.openNow",
      },
      body: JSON.stringify({
        includedTypes: ["hospital"],
        maxResultCount: 10,
        locationRestriction: {
          circle: {
            center: { latitude: roundedLat, longitude: roundedLng },
            radius: SEARCH_RADIUS_METERS,
          },
        },
      }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Places API error ${res.status}`);
        return (await res.json()) as PlacesNearbySearchResponse;
      })
      .then((data) => {
        const results: NearbyHospital[] = (data.places ?? [])
          .filter((p) => p.location)
          .map((p) => ({
            id: p.id,
            name: p.displayName?.text ?? "Hospital",
            lat: p.location!.latitude,
            lng: p.location!.longitude,
            address: p.formattedAddress ?? null,
            rating: p.rating ?? null,
            openNow: p.currentOpeningHours?.openNow ?? null,
          }));
        setHospitals(results);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load nearby hospitals");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });

    return () => controller.abort();
  }, [roundedLat, roundedLng, apiKey]);

  return { hospitals, isLoading, error };
}
