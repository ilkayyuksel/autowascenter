// The admin E2E suite imports the FRONTEND's API client (src/lib/api/client.ts), which is
// typed against the browser's fetch types. This package's tsconfig deliberately has no "DOM"
// lib, so server code cannot reach for document, window or localStorage -- and that guardrail
// is worth keeping. These two aliases are the only browser type names the frontend client
// needs; they point at the very types Node's own fetch uses, so no second definition exists.

type BodyInit = import("undici-types/fetch").BodyInit;
type HeadersInit = import("undici-types/fetch").HeadersInit;
