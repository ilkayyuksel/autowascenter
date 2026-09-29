import type { FastifyInstance } from "fastify";
import { authenticate, requirePermission } from "../../auth/plugin.ts";
import { ADMIN_ACCESS } from "../../auth/principal.ts";

/**
 * Admin routes, mounted under /api/admin. Every route in this plugin requires a valid
 * Auth0 access token with the `admin:access` permission (hooks apply plugin-wide).
 * Phase 5 only has /me, to test authentication + authorization end to end.
 */
export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requirePermission(ADMIN_ACCESS));

  app.get("/me", async (request) => {
    const principal = request.principal!;
    // Only the subject and permissions: no token, no profile data, no other claims.
    return { data: { sub: principal.sub, permissions: principal.permissions } };
  });
}
