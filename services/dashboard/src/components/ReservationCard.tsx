import type { Reservation } from "../types";
import { ambulanceDisplayName, hospitalDisplayName } from "../glossary";

export function ReservationCard({ reservation }: { reservation: Reservation | null }) {
  return (
    <div className="card">
      <h2>Booking</h2>
      <p className="muted panel-intro">
        The lock that prevents two calls from double-booking the same ambulance — enforced by the
        database, not just app logic.
      </p>
      {reservation ? (
        <dl className="field-list">
          <dt>Ambulance</dt>
          <dd>{ambulanceDisplayName(reservation.ambulance_id)}</dd>

          <dt>Hospital</dt>
          <dd>{hospitalDisplayName(reservation.hospital_id)}</dd>

          <dt>Status</dt>
          <dd>
            {reservation.confirmed ? (
              <span className="pill pill-success">confirmed</span>
            ) : (
              <span className="pill pill-warning">pending</span>
            )}
          </dd>

          <dt>Booking ID</dt>
          <dd className="muted field-mono">{reservation.reservation_id}</dd>
        </dl>
      ) : (
        <p className="muted">No booking made yet.</p>
      )}
    </div>
  );
}
