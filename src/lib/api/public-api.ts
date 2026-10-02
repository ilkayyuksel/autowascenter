// The public pages' API client: the same central client (src/lib/api/client.ts), created
// once without a token provider, so public calls can never send an Authorization header.
import { readApiBaseUrl } from "@/lib/auth/auth-config";
import { createApiClient } from "./client";

export const publicApi = createApiClient({ baseUrl: readApiBaseUrl(import.meta.env) });
