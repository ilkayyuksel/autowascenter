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
    }

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
