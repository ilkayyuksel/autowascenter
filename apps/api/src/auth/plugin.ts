// Request authentication and authorization.
//
// request → extract "Bearer <token>" → verify JWT → attach request.principal
//         → requirePermission(...) → route
//
// Responses never reveal why a token was rejected; the reason is logged as a short code only.
// The token itself is never logged (the Authorization header is also redacted by the logger).

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from "fastify";
import { AppError } from "../errors/app-error.ts";
import { hasPermission, type Principal } from "./principal.ts";
import { TokenVerificationError, type TokenVerifier } from "./verifier.ts";

declare module "fastify" {
  interface FastifyInstance {
    /** null when Auth0 is not configured: protected routes then answer 503, never allow. */
    tokenVerifier: TokenVerifier | null;
  }
  interface FastifyRequest {
    principal: Principal | null;
  }
}

const BEARER = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*)$/;

export const authenticationRequired = () =>
  new AppError(401, "AUTHENTICATION_REQUIRED", "Authentication is required.");
export const authenticationInvalid = () =>
  new AppError(401, "AUTHENTICATION_INVALID", "The access token is not valid.");
export const authorizationRequired = () =>
  new AppError(403, "AUTHORIZATION_REQUIRED", "You do not have permission for this action.");
const authenticationUnavailable = () =>
  new AppError(503, "AUTHENTICATION_UNAVAILABLE", "Authentication is temporarily unavailable.");

export function registerAuth(app: FastifyInstance, verifier: TokenVerifier | null) {
  app.decorate("tokenVerifier", verifier);
  app.decorateRequest("principal", null);
}

function challenge(reply: FastifyReply, invalid: boolean) {
  reply.header("WWW-Authenticate", invalid ? 'Bearer error="invalid_token"' : "Bearer");
}

/** preHandler: requires a valid access token and attaches `request.principal`. */
export const authenticate: preHandlerAsyncHookHandler = async function (
  this: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const verifier = request.server.tokenVerifier;
  if (!verifier) {
    request.log.error("protected route called but Auth0 is not configured");
    throw authenticationUnavailable();
  }

  const header = request.headers.authorization;
  if (!header) {
    challenge(reply, false);
    throw authenticationRequired();
  }
  const match = BEARER.exec(header);
  if (!match) {
    request.log.info({ reason: "malformed_authorization_header" }, "access token rejected");
    challenge(reply, true);
    throw authenticationInvalid();
  }

  try {
    request.principal = await verifier.verify(match[1]!);
  } catch (error) {
    const failure =
      error instanceof TokenVerificationError
        ? error
        : new TokenVerificationError("unavailable", "unexpected_verifier_error");
    if (failure.kind === "unavailable") {
      request.log.error({ reason: failure.reason }, "access token could not be verified");
      throw authenticationUnavailable();
    }
    request.log.info({ reason: failure.reason }, "access token rejected");
    challenge(reply, true);
    throw authenticationInvalid();
  }
};

/** preHandler factory: requires an Auth0 RBAC permission (use after `authenticate`). */
export function requirePermission(permission: string): preHandlerAsyncHookHandler {
  return async function (request: FastifyRequest) {
    const principal = request.principal;
    if (!principal) throw authenticationRequired();
    if (!hasPermission(principal, permission)) {
      request.log.info({ sub: principal.sub, permission }, "permission denied");
      throw authorizationRequired();
    }
  };
}
