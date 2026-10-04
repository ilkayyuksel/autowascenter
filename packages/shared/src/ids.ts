// The one definition of a database id, shared by every request and response contract.
//
// It accepts what a PostgreSQL `uuid` column accepts: 8-4-4-4-12 hexadecimal, case
// insensitive. It deliberately does NOT use zod's `z.uuid()`, which additionally enforces
// the RFC 4122 version and variant bits.
//
// Why: the production catalogue delivered for the import uses readable ids such as
// 11111111-1111-1111-1111-111111111101. PostgreSQL stores and compares those like any
// other uuid, but their variant nibble is not one of 8/9/a/b, so `z.uuid()` rejected them.
// That turned real production data into HTTP 400 on GET /api/vehicle-types/:id/services,
// GET /api/availability and POST /api/bookings -- the entire public booking flow. The RFC
// bits carry no correctness or security meaning for us: an id is an opaque key, the
// database is the authority on its format, and every id is still checked strictly enough
// that no free-form string can reach a query. See docs/PRODUCTION-DATA-IMPORT.md.

import { z } from "zod";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A database id: the format PostgreSQL's `uuid` type accepts. */
export const uuid = () => z.string().regex(UUID_PATTERN, "invalid id");

/** True when `value` is a usable database id. */
export const isUuid = (value: string): boolean => UUID_PATTERN.test(value);
