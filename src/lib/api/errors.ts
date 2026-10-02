// Maps any failure of an admin API call to what the admin UI shows. Only these fixed Dutch
// texts reach the screen; backend messages and technical details do not.

import { ApiError, CLIENT_ERROR } from "./client.ts";

export type ApiErrorKind =
  /** 401: the guard re-checks the session and offers a new login. */
  | "reauth"
  /** 403: logged in without admin:access. */
  | "forbidden"
  /** 503, network failure, timeout: temporary, retryable. */
  | "unavailable"
  /** 500 SETTINGS_NOT_CONFIGURED: data/configuration problem on the server. */
  | "not_configured"
  /** 404 for a specific resource. */
  | "not_found"
  /** Response did not match the contract (frontend/backend version mismatch). */
  | "invalid"
  | "generic";

export interface ApiErrorView {
  kind: ApiErrorKind;
  title: string;
  message: string;
  /** false for errors a retry cannot fix. */
  retryable: boolean;
}

export function describeApiError(error: unknown): ApiErrorView {
  if (!(error instanceof ApiError)) {
    return {
      kind: "generic",
      title: "Er ging iets mis",
      message: "De gegevens konden niet geladen worden.",
      retryable: true,
    };
  }
  if (error.status === 401) {
    return {
      kind: "reauth",
      title: "Sessie verlopen",
      message: "Je sessie is verlopen of niet meer geldig. Log opnieuw in.",
      retryable: false,
    };
  }
  if (error.status === 403) {
    return {
      kind: "forbidden",
      title: "Geen toegang",
      message: "Je account heeft geen admin-rechten voor deze gegevens.",
      retryable: false,
    };
  }
  if (error.code === "SETTINGS_NOT_CONFIGURED") {
    return {
      kind: "not_configured",
      title: "Instellingen ontbreken",
      message:
        "Er zijn nog geen algemene instellingen geconfigureerd in de database. Neem contact op met de beheerder.",
      retryable: false,
    };
  }
  if (error.status === 404) {
    return {
      kind: "not_found",
      title: "Niet gevonden",
      message: "Dit item bestaat niet (meer).",
      retryable: false,
    };
  }
  if (
    error.status === 503 ||
    error.code === CLIENT_ERROR.NETWORK ||
    error.code === CLIENT_ERROR.TIMEOUT ||
    error.code === CLIENT_ERROR.TOKEN_UNAVAILABLE
  ) {
    return {
      kind: "unavailable",
      title: "Server tijdelijk niet bereikbaar",
      message: "De server antwoordt momenteel niet. Probeer het zo meteen opnieuw.",
      retryable: true,
    };
  }
  if (error.code === CLIENT_ERROR.INVALID_RESPONSE) {
    return {
      kind: "invalid",
      title: "Onverwacht antwoord",
      message: "De server gaf een onverwacht antwoord. Herlaad de pagina of probeer later opnieuw.",
      retryable: true,
    };
  }
  return {
    kind: "generic",
    title: "Er ging iets mis",
    message: "De gegevens konden niet geladen worden. Probeer het opnieuw.",
    retryable: true,
  };
}

/** Results of requests the caller cancelled itself are ignored, not shown. */
export const isAborted = (error: unknown) =>
  error instanceof ApiError && error.code === CLIENT_ERROR.ABORTED;

/** At most one automatic session re-check per window, so a 401 can never cause a loop. */
export const SESSION_RECHECK_INTERVAL_MS = 30_000;

export function shouldRecheckSession(lastRecheckAt: number | null, now: number): boolean {
  return lastRecheckAt === null || now - lastRecheckAt >= SESSION_RECHECK_INTERVAL_MS;
}

// ---------- Writes ----------

export interface WriteErrorView {
  kind:
    | "validation"
    | "reauth"
    | "forbidden"
    | "not_found"
    | "slot_unavailable"
    | "in_use"
    | "conflict"
    | "planning"
    | "file"
    | "rate_limited"
    | "unavailable"
    | "unknown_outcome"
    | "invalid"
    | "aborted"
    | "generic";
  /** Fixed Dutch text for a toast; never a backend/database message. */
  message: string;
  /** The shown data is (probably) stale: the page should reload it from the API. */
  refresh: boolean;
}

export function describeWriteError(error: unknown): WriteErrorView {
  const view = (kind: WriteErrorView["kind"], message: string, refresh = false) => ({
    kind,
    message,
    refresh,
  });
  if (!(error instanceof ApiError)) return view("generic", "Er ging iets mis bij het opslaan.");
  const { status, code } = error;

  if (code === CLIENT_ERROR.ABORTED) return view("aborted", "");
  const fileProblem = (error as { fields?: Record<string, string> }).fields?.file;
  if (code === CLIENT_ERROR.VALIDATION && fileProblem) return view("file", fileProblem);
  if (code === CLIENT_ERROR.VALIDATION || (status === 400 && code === "VALIDATION_ERROR")) {
    return view("validation", "Ongeldige invoer. Controleer de velden.");
  }
  if (status === 401) return view("reauth", "Je sessie is verlopen. Log opnieuw in.");
  if (status === 403)
    return view("forbidden", "Geen toegang: je account heeft geen admin-rechten.");
  if (code === "VEHICLE_TYPE_NOT_FOUND") {
    return view("not_found", "Het gekozen voertuigtype is niet (meer) beschikbaar.", true);
  }
  if (code === "SERVICE_NOT_FOUND") {
    return view("not_found", "Een gekozen dienst is niet beschikbaar voor dit voertuigtype.", true);
  }
  if (status === 404)
    return view("not_found", "Dit item bestaat niet meer. De gegevens worden ververst.", true);
  if (code === "BOOKING_SLOT_UNAVAILABLE") {
    return view(
      "slot_unavailable",
      "Dit tijdslot is intussen bezet. Kies een ander vrij slot.",
      true,
    );
  }
  if (code === "RESOURCE_IN_USE") {
    return view(
      "in_use",
      "Dit item wordt nog gebruikt (bv. door reservaties) en kan niet verwijderd worden.",
    );
  }
  if (status === 409)
    return view(
      "conflict",
      "Deze wijziging botst met bestaande gegevens (bv. een slug die al bestaat).",
      true,
    );
  if (code === "BOOKING_IN_PAST") return view("planning", "Dit tijdstip ligt in het verleden.");
  if (code === "BOOKING_OUTSIDE_OPENING_HOURS") {
    return view("planning", "Dit tijdstip valt buiten de openingsuren of het tijdsrooster.");
  }
  if (status === 422) return view("planning", "Ongeldige planning.");
  if (code === "FILE_TOO_LARGE" || status === 413) return view("file", "Het bestand is te groot.");
  if (code === "UNSUPPORTED_MEDIA_TYPE" || status === 415) {
    return view("file", "Alleen JPEG-, PNG- en WebP-afbeeldingen zijn toegestaan.");
  }
  if (code === "EMPTY_FILE") return view("file", "Het bestand is leeg.");
  if (status === 429) return view("rate_limited", "Te veel aanvragen. Probeer het later opnieuw.");
  if (code === "STORAGE_UNAVAILABLE")
    return view("unavailable", "De bestandsopslag is momenteel niet beschikbaar.");
  if (code === CLIENT_ERROR.TIMEOUT) {
    return view(
      "unknown_outcome",
      "De server antwoordde niet op tijd. De gegevens worden ververst; controleer of de wijziging is opgeslagen.",
      true,
    );
  }
  if (status === 503 || code === CLIENT_ERROR.NETWORK || code === CLIENT_ERROR.TOKEN_UNAVAILABLE) {
    return view("unavailable", "Server tijdelijk niet bereikbaar. Probeer het zo meteen opnieuw.");
  }
  if (code === CLIENT_ERROR.INVALID_RESPONSE) {
    return view("invalid", "Onverwacht antwoord van de server. De gegevens worden ververst.", true);
  }
  return view("generic", "Er ging iets mis bij het opslaan.");
}
