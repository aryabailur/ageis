import { useEffect, useMemo, useRef, useState } from "react";
import { GoogleMap, OverlayView, Polyline, useJsApiLoader } from "@react-google-maps/api";
import type { Ambulance, DispatchState, FleetSnapshot, Hospital } from "../types";
import { useDeviceLocation } from "../hooks/useDeviceLocation";
import { useNearbyHospitals } from "../hooks/useNearbyHospitals";
import { useVoiceStore } from "../store/voiceStore";

interface Props {
  fleet: FleetSnapshot | null;
  current: DispatchState | null;
}

const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

const FALLBACK_CENTER = { lat: 42.36, lng: -71.06 };

const MAP_CONTAINER_STYLE = { width: "100%", height: "100%" };

// Flat dark theme to match the command-center aesthetic instead of Google's
// default light basemap -- roughly mirrors the old Mapbox dark-v11 look.
const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#1a1d23" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1d23" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#6b7280" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#374151" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#2a2f38" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#5b6472" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#374151" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#111418" }] },
];

const MAP_OPTIONS: google.maps.MapOptions = {
  styles: DARK_MAP_STYLE,
  disableDefaultUI: true,
  zoomControl: true,
  clickableIcons: false,
};

function hospitalColorClass(status: string): string {
  return status === "OPEN" ? "map-marker-hospital-open" : "map-marker-hospital-diversion";
}

/**
 * Progress of the selected ambulance from its start position toward the
 * incident. Real dispatch (simulate_dispatch complete) reaches 1 -- the
 * unit is treated as having arrived once AEGIS has locked and confirmed
 * the assignment, since there's no live vehicle telemetry to interpolate
 * against. Before that, the marker sits at the ambulance's actual seeded
 * position (0) rather than faking motion with no real signal behind it.
 */
function ambulanceProgress(state: DispatchState): number {
  const log = state.timing_log ?? [];
  const dispatchedOrLater = log.some((e) => e.step === "simulate_dispatch" && e.end != null);
  return dispatchedOrLater ? 1 : 0;
}

function computeBounds(points: Array<{ lat: number; lng: number }>): google.maps.LatLngBoundsLiteral | null {
  if (points.length === 0) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return {
    south: Math.min(...lats),
    north: Math.max(...lats),
    west: Math.min(...lngs),
    east: Math.max(...lngs),
  };
}

function Pin({ lat, lng, className, title }: { lat: number; lng: number; className: string; title?: string }) {
  return (
    <OverlayView position={{ lat, lng }} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
      <div className={`map-pin ${className}`} title={title} style={{ transform: "translate(-50%, -50%)" }} />
    </OverlayView>
  );
}

export function CityMap({ fleet, current }: Props) {
  const mapRef = useRef<google.maps.Map | null>(null);
  const { isLoaded, loadError } = useJsApiLoader({
    id: "aegis-google-maps",
    googleMapsApiKey: GOOGLE_MAPS_KEY ?? "",
  });

  const device = useDeviceLocation();
  const { hospitals: nearbyHospitals } = useNearbyHospitals(device.lat, device.lng, GOOGLE_MAPS_KEY);

  // Prefer the dispatch result's coords (most accurate — set by the backend
  // after triage). Fall back to the live voice store's coords, which the
  // mobile conversation hook pushes in on the first transcript POST so the
  // patient pin appears during the call, before dispatch runs.
  const voiceCallerLat = useVoiceStore((s) => s.callerLat);
  const voiceCallerLng = useVoiceStore((s) => s.callerLng);
  const incidentLat = current?.caller_lat ?? voiceCallerLat;
  const incidentLng = current?.caller_lng ?? voiceCallerLng;
  const ambulances: Ambulance[] = fleet?.ambulances ?? [];
  const hospitals: Hospital[] = fleet?.hospitals ?? [];

  const points = useMemo(() => {
    const pts: Array<{ lat: number; lng: number }> = [];
    ambulances.forEach((a) => pts.push({ lat: a.lat, lng: a.lng }));
    hospitals.forEach((h) => pts.push({ lat: h.lat, lng: h.lng }));
    if (incidentLat !== null && incidentLng !== null) pts.push({ lat: incidentLat, lng: incidentLng });
    if (device.lat !== null && device.lng !== null) pts.push({ lat: device.lat, lng: device.lng });
    nearbyHospitals.forEach((h) => pts.push({ lat: h.lat, lng: h.lng }));
    return pts;
  }, [ambulances, hospitals, incidentLat, incidentLng, device.lat, device.lng, nearbyHospitals]);

  const bounds = useMemo(() => computeBounds(points), [points]);

  useEffect(() => {
    if (mapRef.current && bounds) {
      mapRef.current.fitBounds(bounds, 64);
    }
  }, [bounds]);

  const selected = current?.selected ?? null;
  const routeFellBack = selected?.route_data_source && selected.route_data_source !== "mcp:routing";

  const routePath = useMemo(() => {
    if (!selected || incidentLat === null || incidentLng === null) return null;
    return [
      { lat: selected.ambulance.lat, lng: selected.ambulance.lng },
      { lat: incidentLat, lng: incidentLng },
    ];
  }, [selected, incidentLat, incidentLng]);

  const progress = current ? ambulanceProgress(current) : 0;
  const routeDot =
    selected && incidentLat !== null && incidentLng !== null
      ? {
          lat: selected.ambulance.lat + (incidentLat - selected.ambulance.lat) * progress,
          lng: selected.ambulance.lng + (incidentLng - selected.ambulance.lng) * progress,
        }
      : null;

  const [center] = useState(() => points[0] ?? FALLBACK_CENTER);

  // Center on the device's real location the first time it arrives --
  // after that, fitBounds (above) takes over as more points appear, so
  // this only needs to fire once rather than fighting the user's pan/zoom.
  const hasCenteredOnDeviceRef = useRef(false);
  useEffect(() => {
    if (hasCenteredOnDeviceRef.current) return;
    if (device.lat === null || device.lng === null || !mapRef.current) return;
    hasCenteredOnDeviceRef.current = true;
    mapRef.current.panTo({ lat: device.lat, lng: device.lng });
    mapRef.current.setZoom(13);
  }, [device.lat, device.lng]);

  return (
    <div className="map-shell">
      {!GOOGLE_MAPS_KEY ? (
        <div className="map-token-missing">
          Set <code>VITE_GOOGLE_MAPS_KEY</code> in .env.local to enable the live map.
        </div>
      ) : loadError ? (
        <div className="map-token-missing">Google Maps failed to load — check the API key and enabled APIs.</div>
      ) : !isLoaded ? (
        <div className="map-token-missing">Loading map…</div>
      ) : (
        <GoogleMap
          mapContainerStyle={MAP_CONTAINER_STYLE}
          center={center}
          zoom={11}
          options={MAP_OPTIONS}
          onLoad={(map) => {
            mapRef.current = map;
            if (bounds) map.fitBounds(bounds, 64);
          }}
        >
          {routePath && (
            <Polyline
              path={routePath}
              options={{
                strokeColor: "#5b8def",
                strokeOpacity: 0.8,
                strokeWeight: 2.5,
                icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 1, scale: 2 }, offset: "0", repeat: "10px" }],
              }}
            />
          )}

          {hospitals.map((h) => (
            <Pin key={h.id} lat={h.lat} lng={h.lng} className={`map-pin-hospital ${hospitalColorClass(h.status)}`} title={h.id} />
          ))}

          {nearbyHospitals.map((h) => (
            <Pin key={h.id} lat={h.lat} lng={h.lng} className="map-pin-nearby-hospital" title={h.name} />
          ))}

          {device.lat !== null && device.lng !== null && (
            <Pin lat={device.lat} lng={device.lng} className="map-pin-device" title="Your location" />
          )}

          {ambulances.map((a) => {
            const isSelectedUnit = selected?.ambulance.id === a.id;
            return (
              <Pin
                key={a.id}
                lat={a.lat}
                lng={a.lng}
                className={`map-pin-unit ${isSelectedUnit ? "map-marker-unit-selected" : "map-marker-unit"}`}
                title={a.id}
              />
            );
          })}

          {incidentLat !== null && incidentLng !== null && (
            <Pin lat={incidentLat} lng={incidentLng} className="map-pin-incident map-marker-incident" title="patient" />
          )}

          {routeDot && <Pin lat={routeDot.lat} lng={routeDot.lng} className="map-pin-route-dot" />}
        </GoogleMap>
      )}

      <div className="map-legend map-floating">
        <span className="map-legend-item"><span className="map-legend-swatch map-legend-hospital-open" />Open</span>
        <span className="map-legend-item"><span className="map-legend-swatch map-legend-hospital-diversion" />Diversion</span>
        <span className="map-legend-item"><span className="map-legend-swatch map-legend-unit" />Ambulance</span>
        <span className="map-legend-item"><span className="map-legend-swatch map-legend-unit-selected" />Assigned</span>
        <span className="map-legend-item"><span className="map-legend-swatch map-legend-incident" />Patient</span>
        <span className="map-legend-item"><span className="map-legend-swatch map-legend-nearby-hospital" />Nearby hospital</span>
        <span className="map-legend-item"><span className="map-legend-swatch map-legend-device" />You</span>
      </div>

      {routeFellBack && (
        <div className="map-floating map-degraded-note">● routing degraded — using cached estimate</div>
      )}

      {device.status === "denied" && (
        <div className="map-floating map-degraded-note map-location-note">
          ● location access denied — enable it in browser settings to see your position
        </div>
      )}
      {device.status === "unsupported" && (
        <div className="map-floating map-degraded-note map-location-note">● geolocation not supported by this browser</div>
      )}

      {nearbyHospitals.length > 0 && (
        <div className="map-floating map-nearby-panel">
          <span className="map-nearby-panel-title">Nearby hospitals ({nearbyHospitals.length})</span>
          <ul className="map-nearby-list">
            {nearbyHospitals.slice(0, 5).map((h) => (
              <li key={h.id} className="map-nearby-item">
                <span className="map-nearby-item-name">{h.name}</span>
                {h.openNow != null && (
                  <span className={`map-nearby-item-status ${h.openNow ? "map-nearby-item-open" : "map-nearby-item-closed"}`}>
                    {h.openNow ? "Open" : "Closed"}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="map-stat-rail">
        <div className="map-stat-card">
          <span className="map-stat-label">ETA</span>
          <span className="map-stat-value">
            {selected?.ambulance_eta_minutes != null ? `${selected.ambulance_eta_minutes.toFixed(1)}m` : "—"}
          </span>
        </div>
        <div className="map-stat-card">
          <span className="map-stat-label">Hospital ETA</span>
          <span className="map-stat-value">
            {selected?.hospital_eta_minutes != null ? `${selected.hospital_eta_minutes.toFixed(1)}m` : "—"}
          </span>
        </div>
        <div className="map-stat-card">
          <span className="map-stat-label">Hospital</span>
          <span className="map-stat-value map-stat-value-text">
            {selected ? selected.hospital.id.replace(/^hosp-/, "").replace(/-/g, " ") : "—"}
          </span>
        </div>
        <div className="map-stat-card">
          <span className="map-stat-label">Ambulance</span>
          <span className="map-stat-value map-stat-value-text">
            {selected ? selected.ambulance.id.replace("unit-", "Unit ") : "Unassigned"}
          </span>
        </div>
      </div>
    </div>
  );
}
