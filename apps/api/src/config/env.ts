import { z } from "zod";

const DEV_CORS_ORIGIN = "http://localhost:8080"; // Vite dev server of the current frontend

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
      for (const key of ["AUTH0_DOMAIN", "AUTH0_AUDIENCE"] as const) {
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
    };
  });

export type Config = z.output<typeof envSchema>;

/**
 * Reads and validates the configuration from environment variables.
 * Throws with the names of invalid variables only; values (secrets) are never included.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid configuration: ${problems}`);
  }
  return result.data;
}
