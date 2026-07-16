import { useMemo } from "react";
import type { Ambulance, DispatchState, FleetSnapshot, Hospital } from "../types";

interface Props {
  fleet: FleetSnapshot | null;
  current: DispatchState | null;
}

interface Bounds {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}

const PADDING_PCT = 12;

function computeBounds(points: Array<{ lat: number; lng: number }>): Bounds {
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  // Guard against a degenerate (near-zero) span collapsing every point onto
  // one pixel when only one location is known.
  const latSpan = maxLat - minLat || 0.01;
  const lngSpan = maxLng - minLng || 0.01;
  return { minLat: minLat - latSpan * 0.15, maxLat: maxLat + latSpan * 0.15, minLng: minLng - lngSpan * 0.15, maxLng: maxLng + lngSpan * 0.15 };
}

function project(lat: number, lng: number, bounds: Bounds): { x: number; y: number } {
  const xPct = ((lng - bounds.minLng) / (bounds.maxLng - bounds.minLng)) * (100 - 2 * PADDING_PCT) + PADDING_PCT;
  // Screen y grows downward; latitude grows northward -- invert.
  const yPct = (1 - (lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * (100 - 2 * PADDING_PCT) + PADDING_PCT;
  return { x: xPct, y: yPct };
}

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
  const dispatchedOrLater = state.timing_log.some((e) => e.step === "simulate_dispatch" && e.end != null);
  return dispatchedOrLater ? 1 : 0;
}

export function CityMap({ fleet, current }: Props) {
  const incidentLat = current?.caller_lat ?? null;
  const incidentLng = current?.caller_lng ?? null;
  const ambulances: Ambulance[] = fleet?.ambulances ?? [];
  const hospitals: Hospital[] = fleet?.hospitals ?? [];

  const bounds = useMemo(() => {
    const points: Array<{ lat: number; lng: number }> = [];
    ambulances.forEach((a) => points.push({ lat: a.lat, lng: a.lng }));
    hospitals.forEach((h) => points.push({ lat: h.lat, lng: h.lng }));
    if (incidentLat !== null && incidentLng !== null) points.push({ lat: incidentLat, lng: incidentLng });
    if (points.length === 0) return computeBounds([{ lat: 42.36, lng: -71.06 }]);
    return computeBounds(points);
  }, [ambulances, hospitals, incidentLat, incidentLng]);

  const selected = current?.selected ?? null;
  const routeFellBack = selected?.route_data_source && selected.route_data_source !== "mcp:routing";

  return (
    <div className="card map-card">
      <div className="map-card-header">
        <h2>Live map</h2>
        {routeFellBack && <span className="map-delay-note">● routing degraded — using cached estimate</span>}
      </div>
      <div className="map-legend">
        <span className="map-legend-item"><span className="map-legend-swatch map-legend-hospital-open" />Hospital, open</span>
        <span className="map-legend-item"><span className="map-legend-swatch map-legend-hospital-diversion" />Hospital, diversion</span>
        <span className="map-legend-item"><span className="map-legend-swatch map-legend-unit" />Ambulance</span>
        <span className="map-legend-item"><span className="map-legend-swatch map-legend-unit-selected" />Assigned unit</span>
        <span className="map-legend-item"><span className="map-legend-swatch map-legend-incident" />Patient</span>
      </div>
      <div className="map-surface">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="map-grid">
          {[20, 40, 60, 80].map((v) => (
            <line key={`v${v}`} x1={v} y1={0} x2={v} y2={100} className="map-gridline" />
          ))}
          {[20, 40, 60, 80].map((v) => (
            <line key={`h${v}`} x1={0} y1={v} x2={100} y2={v} className="map-gridline" />
          ))}

          {hospitals.map((h) => {
            const p = project(h.lat, h.lng, bounds);
            return (
              <g key={h.id} transform={`translate(${p.x} ${p.y})`}>
                <rect x={-2.2} y={-2.2} width={4.4} height={4.4} rx={1} className={`map-marker ${hospitalColorClass(h.status)}`} />
                <text x={0} y={-3.2} className="map-label map-label-halo" textAnchor="middle">
                  {h.id.replace("hosp-", "")}
                </text>
              </g>
            );
          })}

          {ambulances.map((a) => {
            const p = project(a.lat, a.lng, bounds);
            const isSelectedUnit = selected?.ambulance.id === a.id;
            return (
              <g key={a.id} transform={`translate(${p.x} ${p.y})`}>
                <rect
                  x={-1.8}
                  y={-1.8}
                  width={3.6}
                  height={3.6}
                  rx={1}
                  className={`map-marker ${isSelectedUnit ? "map-marker-unit-selected" : "map-marker-unit"}`}
                />
                <text x={0} y={4.6} className="map-label map-label-halo" textAnchor="middle">
                  {a.id.replace("unit-", "U")}
                </text>
              </g>
            );
          })}

          {incidentLat !== null && incidentLng !== null && (
            <g transform={`translate(${project(incidentLat, incidentLng, bounds).x} ${project(incidentLat, incidentLng, bounds).y})`}>
              <circle r={2.4} className="map-marker-incident" />
              <circle r={2.4} className="map-marker-incident-pulse" />
              <text x={0} y={5.8} className="map-label map-label-halo" textAnchor="middle">
                incident
              </text>
            </g>
          )}

          {selected && incidentLat !== null && incidentLng !== null && (
            <RouteLine
              from={project(selected.ambulance.lat, selected.ambulance.lng, bounds)}
              to={project(incidentLat, incidentLng, bounds)}
              progress={current ? ambulanceProgress(current) : 0}
            />
          )}
        </svg>
      </div>
      <div className="map-footer">
        {selected ? (
          <>
            Unit {selected.ambulance.id.replace("unit-", "")} → scene
            {selected.ambulance_eta_minutes !== null && (
              <span className="map-eta"> ETA {selected.ambulance_eta_minutes.toFixed(1)} min</span>
            )}
          </>
        ) : (
          <span className="muted">No unit selected yet</span>
        )}
      </div>
    </div>
  );
}

function RouteLine({
  from,
  to,
  progress,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  progress: number;
}) {
  const cx = from.x + (to.x - from.x) * progress;
  const cy = from.y + (to.y - from.y) * progress;
  return (
    <>
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="map-route-line" />
      <circle cx={cx} cy={cy} r={1.4} className="map-route-progress-dot" />
    </>
  );
}
