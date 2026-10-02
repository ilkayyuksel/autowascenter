// Edit form of an existing appointment → PATCH body with ONLY the changed fields that the
// contract allows. Never price, duration, totals, start/end, cancel token or cancelled_at:
// the server derives those (cancelled_at from the status, totals from the services).

import type { AdminBookingPatchInput } from "../../../packages/shared/src/admin-write.ts";
import type { BookingStatus } from "./admin-reads.ts";

export interface BookingEditState {
  preferred_date: string;
  preferred_time: string;
  status: BookingStatus;
  notes: string;
  vehicle_type_id: string;
  service_ids: string[];
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

export function bookingPatchFrom(
  original: BookingEditState,
  edit: BookingEditState,
): AdminBookingPatchInput {
  const patch: AdminBookingPatchInput = {};
  if (edit.preferred_date !== original.preferred_date) patch.preferred_date = edit.preferred_date;
  if (edit.preferred_time !== original.preferred_time) patch.preferred_time = edit.preferred_time;
  if (edit.status !== original.status) patch.status = edit.status;
  if (edit.notes.trim() !== original.notes.trim()) patch.notes = edit.notes;
  const vehicleChanged = edit.vehicle_type_id !== original.vehicle_type_id;
  if (vehicleChanged || !sameSet(edit.service_ids, original.service_ids)) {
    // A new vehicle type always needs the services that go with it (re-priced together).
    if (vehicleChanged) patch.vehicle_type_id = edit.vehicle_type_id;
    patch.service_ids = edit.service_ids;
  }
  return patch;
}
