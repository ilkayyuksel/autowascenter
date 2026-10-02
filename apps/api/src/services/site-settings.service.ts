import type { Database } from "../db/index.ts";
import { siteSettings } from "../db/schema/index.ts";
import { AppError } from "../errors/app-error.ts";
import type { PublicSiteSettings } from "../contracts/public.ts";

/**
 * Public subset of the single site_settings row. Selects only the two public columns, so
 * admin-only data (notification_email, base address, ...) cannot leak into the response.
 */
export async function getPublicSiteSettings(db: Database): Promise<PublicSiteSettings> {
  const [row] = await db
    .select({ kmFee: siteSettings.kmFee, freeKm: siteSettings.freeKm })
    .from(siteSettings)
    .limit(1);
  if (!row) {
    throw new AppError(500, "SETTINGS_NOT_CONFIGURED", "Site settings are not configured.");
  }
  return { km_fee: Number(row.kmFee), free_km: Number(row.freeKm) };
}
