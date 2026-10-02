import { z } from "zod";

const DEV_CORS_ORIGIN = "http://localhost:8080"; // Vite dev server of the current frontend

/**
 * Fastify's `trustProxy`: false (off), true (trust the proxy in front), or a
 * comma-separated list of trusted proxy addresses/subnets (stricter: a forged
 * X-Forwarded-For from anywhere else is then ignored).
 */
function parseTrustProxy(value: string | undefined): boolean | string {
  if (value === undefined) return false;
  const normalized = value.toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return value;
}

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    CORS_ORIGIN: z.string().optional(),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    /** POST /api/bookings: max requests per client IP per window. */
    BOOKING_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(10),
    BOOKING_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(60_000),
    /** Auth0 tenant host, e.g. "autowascenter.eu.auth0.com" (no scheme, no path). */
    AUTH0_DOMAIN: z
      .string()
      .regex(/^[a-z0-9.-]+$/i, "must be a host name like tenant.eu.auth0.com")
      .optional(),
    /** Identifier of the Auth0 API; must equal the frontend's VITE_AUTH0_AUDIENCE. */
    AUTH0_AUDIENCE: z.string().min(1).optional(),
    /** Optional override; defaults to https://<AUTH0_DOMAIN>/ (Auth0's issuer format). */
    AUTH0_ISSUER: z
      .string()
      .regex(/^https:\/\/[^/]+\/$/, "must look like https://<domain>/")
      .optional(),
    /**
     * Behind a reverse proxy (Caddy in the Docker stack) the socket address is the proxy's,
     * so the real client IP must be taken from X-Forwarded-For. Without this, the per-IP
     * rate limits would count every visitor as one client. Values: "true" (trust the proxy
     * in front) or a comma-separated list of trusted proxy IPs/subnets. Default off, so a
     * directly exposed API can never be spoofed through a forged header.
     */
    TRUST_PROXY: z.string().trim().min(1).optional(),
    /** Root of the local file storage (a Docker volume in production). */
    UPLOAD_DIR: z.string().min(1).default("./uploads"),
    /** Public base URL of uploaded files, without trailing slash; required in production. */
    PUBLIC_UPLOAD_URL: z
      .string()
      .regex(/^https?:\/\/[^\s?#]+[^/\s?#]$/, "must be an http(s) URL without trailing slash")
      .optional(),
    /** Max size of one uploaded file (default 10 MiB). */
    MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(50 * 1024 * 1024)
      .default(10_485_760),
    /** POST /api/admin/gallery/upload: max uploads per client IP per window. */
    UPLOAD_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(30),
    UPLOAD_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(3_600_000),
  })
  .transform((env, ctx) => {
    const rawOrigins = env.CORS_ORIGIN ?? (env.NODE_ENV === "production" ? "" : DEV_CORS_ORIGIN);
    const corsOrigins = rawOrigins
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);

    if (env.NODE_ENV === "production") {
      if (corsOrigins.length === 0) {
        ctx.addIssue({ code: "custom", path: ["CORS_ORIGIN"], message: "required in production" });
      }
      if (corsOrigins.includes("*")) {
        ctx.addIssue({
          code: "custom",
          path: ["CORS_ORIGIN"],
          message: '"*" is not allowed in production',
        });
      }
      for (const key of ["AUTH0_DOMAIN", "AUTH0_AUDIENCE", "PUBLIC_UPLOAD_URL"] as const) {
        if (!env[key])
          ctx.addIssue({ code: "custom", path: [key], message: "required in production" });
      }
    }
    if (Boolean(env.AUTH0_DOMAIN) !== Boolean(env.AUTH0_AUDIENCE)) {
      ctx.addIssue({
        code: "custom",
        path: ["AUTH0_AUDIENCE"],
        message: "AUTH0_DOMAIN and AUTH0_AUDIENCE must be set together",
      });
    }

    // Without Auth0 settings (local development only) protected routes answer 503; never open.
    const auth0 =
      env.AUTH0_DOMAIN && env.AUTH0_AUDIENCE
        ? {
            domain: env.AUTH0_DOMAIN,
            audience: env.AUTH0_AUDIENCE,
            issuer: env.AUTH0_ISSUER ?? `https://${env.AUTH0_DOMAIN}/`,
            jwksUrl: `https://${env.AUTH0_DOMAIN}/.well-known/jwks.json`,
          }
        : null;

    return {
      nodeEnv: env.NODE_ENV,
      trustProxy: parseTrustProxy(env.TRUST_PROXY),
      isProduction: env.NODE_ENV === "production",
      databaseUrl: env.DATABASE_URL,
      host: env.HOST,
      port: env.PORT,
      corsOrigins,
      logLevel: env.LOG_LEVEL,
      bookingRateLimit: {
        max: env.BOOKING_RATE_LIMIT_MAX,
        timeWindowMs: env.BOOKING_RATE_LIMIT_WINDOW_MS,
      },
      auth0,
      uploads: {
        dir: env.UPLOAD_DIR,
        // Development default: served by this API on its own port.
        publicBaseUrl: env.PUBLIC_UPLOAD_URL ?? `http://localhost:${env.PORT}/uploads`,
        maxBytes: env.MAX_UPLOAD_BYTES,
        rateLimit: {
          max: env.UPLOAD_RATE_LIMIT_MAX,
          timeWindowMs: env.UPLOAD_RATE_LIMIT_WINDOW_MS,
        },
      },
    };
  });

export type Config = z.output<typeof envSchema>;

/**
 * Reads and validates the configuration from environment variables.
 * Throws with the names of invalid variables only; values (secrets) are never included.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // An empty value counts as "not set". Docker Compose always defines every key listed in
  // a service's `environment`, so an optional setting left blank in the deploy .env would
  // otherwise be parsed as the empty string and fail validation.
  const provided = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const result = envSchema.safeParse(provided);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  return result.data;
}
