import type { Reservation } from "../types";

export function ReservationCard({ reservation }: { reservation: Reservation | null }) {
  return (
    <div className="card">
      <h2>Reservation</h2>
      {reservation ? (
        <dl className="field-list">
          <dt>Reservation ID</dt>
          <dd>{reservation.reservation_id}</dd>

          <dt>Ambulance</dt>
          <dd>{reservation.ambulance_id}</dd>

          <dt>Hospital</dt>
          <dd>{reservation.hospital_id}</dd>

          <dt>Confirmed</dt>
          <dd>
            {reservation.confirmed ? (
              <span className="pill pill-success">confirmed</span>
            ) : (
              <span className="pill pill-warning">pending</span>
            )}
          </dd>
        </dl>
      ) : (
        <p className="muted">No reservation was made.</p>
      )}
    </div>
  );
}
