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
